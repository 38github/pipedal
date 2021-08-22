#include "pch.h"
#include "BeastServer.hpp"
#include <iostream>
#include "Lv2Log.hpp"

#include "PiPedalSocket.hpp"
#include "Lv2Host.hpp"
#include <boost/system/error_code.hpp>
#include <filesystem>
#include "PiPedalConfiguration.hpp"
#include "Shutdown.hpp"
#include "CommandLineParser.hpp"
#include "Lv2SystemdLogger.hpp"
#include <sys/stat.h>
#include <boost/asio.hpp>
#include "HtmlHelper.hpp"

#include <signal.h>
#include <semaphore.h>

using namespace pipedal;
using namespace boost::beast;

#define PRESET_EXTENSION ".piPreset"
#define BANK_EXTENSION ".piBank"

sem_t signalSemaphore;

class application_category : public boost::system::error_category
{
public:
    const char *name() const noexcept { return "PiPedal"; }
    std::string message(int ev) const { return "error message"; }
};

void sig_handler(int signo)
{
    sem_post(&signalSemaphore);
}
using namespace boost::system;


class DownloadIntercept : public RequestHandler
{
    PiPedalModel *model;

public:
    DownloadIntercept(PiPedalModel *model)
        : RequestHandler("/var"),
          model(model)
    {
    }

    virtual bool wants(boost::beast::http::verb verb, const uri &request_uri) const
    {
        if (request_uri.segment_count() != 2 || request_uri.segment(0) != "var")
        {
            return false;
        }
        if (request_uri.segment(1) == "downloadPreset")
        {
            std::string strInstanceId = request_uri.query("id");
            if (strInstanceId != "")
                return true;
        }
        if (request_uri.segment(1) == "uploadPreset")
        {
            return true;
        }
        return false;
    }


    std::string GetContentDispositionHeader(const std::string &name, const std::string &extension)
    {
        std::string fileName = name.substr(0,64) + extension;
        std::stringstream s;
        
        s << "attachment; filename*=" << HtmlHelper::Rfc5987EncodeFileName(fileName) << "; filename=\"" << HtmlHelper::SafeFileName(fileName) << "\"";
        std::string result = s.str();
        return result;
    }

    void GetPreset(const uri &request_uri, std::string *pName, std::string *pContent)
    {
        std::string strInstanceId = request_uri.query("id");
        int64_t instanceId = std::stol(strInstanceId);
        auto pedalBoard = model->getPreset(instanceId);

        // a certain elegance to using same file format for banks and presets.
        BankFile file;
        file.name(pedalBoard.name());
        int64_t newInstanceId = file.addPreset(pedalBoard);
        file.selectedPreset(newInstanceId);

        std::stringstream s;
        json_writer writer(s);
        writer.write(file);
        *pContent = s.str();
        *pName = pedalBoard.name();
    }

    virtual void head_response(
        const uri &request_uri,
        const boost::beast::http::request<boost::beast::http::string_body> &req,
        boost::beast::http::response<boost::beast::http::empty_body> &res,
        boost::beast::error_code &ec)
    {
        try
        {
            if (request_uri.segment(1) == "downloadPreset")
            {
                std::string name;
                std::string content;
                GetPreset(request_uri, &name, &content);

                res.set(http::field::content_type, "application/octet-stream");
                res.set(http::field::cache_control, "no-cache");
                res.set(http::field::content_length, content.length());
                res.set(http::field::content_disposition, GetContentDispositionHeader(name, PRESET_EXTENSION));
                return;
            } 
            throw PiPedalException("Not found.");
        }
        catch (const std::exception &e)
        {
            if (strcmp(e.what(), "Not found") == 0)
            {
                ec = boost::system::errc::make_error_code(boost::system::errc::no_such_file_or_directory);
            }
            else
            {
                ec = boost::system::errc::make_error_code(boost::system::errc::invalid_argument);
            }
        }
    }

    virtual void get_response(
        const uri &request_uri,
        const boost::beast::http::request<boost::beast::http::string_body> &req,
        boost::beast::http::response<boost::beast::http::string_body> &res,
        boost::beast::error_code &ec)
    {
        try
        {
            if (request_uri.segment(1) == "downloadPreset")
            {
                std::string name;
                std::string content;
                GetPreset(request_uri, &name, &content);

                res.set(http::field::content_type, "application/octet-stream");
                res.set(http::field::cache_control, "no-cache");
                res.set(http::field::content_length, content.length());
                res.set(http::field::content_disposition, GetContentDispositionHeader(name, PRESET_EXTENSION));
                res.body() = content;
            } 
        }
        catch (const std::exception &e)
        {
            if (strcmp(e.what(), "Not found") == 0)
            {
                ec = boost::system::errc::make_error_code(boost::system::errc::no_such_file_or_directory);
            }
            else
            {
                ec = boost::system::errc::make_error_code(boost::system::errc::invalid_argument);
            }
        }
    }
    virtual void post_response(
        const uri &request_uri,
        const boost::beast::http::request<boost::beast::http::string_body> &req,
        boost::beast::http::response<boost::beast::http::string_body> &res,
        boost::beast::error_code &ec)
    {
        try
        {
            if (request_uri.segment(1) == "uploadPreset")
            {
                std::string presetBody = req.body();
                std::stringstream s(presetBody);
                json_reader reader(s);

                uint64_t uploadAfter = -1;
                std::string strUploadAfter = request_uri.query("uploadAfter");
                if (strUploadAfter.length() != 0)
                {
                    uploadAfter = std::stol(strUploadAfter);
                }

                BankFile bankFile;
                reader.read(&bankFile);

                uint64_t instanceId = model->uploadPreset(bankFile,uploadAfter);

                res.set(http::field::content_type, "application/json");
                res.set(http::field::cache_control, "no-cache");
                std::stringstream sResult;
                sResult << instanceId;
                std::string result = sResult.str();
                res.set(http::field::content_length, result.length());

                res.body() = result;
            }
        }
        catch (const std::exception &e)
        {
            if (strcmp(e.what(), "Not found") == 0)
            {
                ec = boost::system::errc::make_error_code(boost::system::errc::no_such_file_or_directory);
            }
            else
            {
                ec = boost::system::errc::make_error_code(boost::system::errc::invalid_argument);
            }
        }
    }

};

/* When hosting a react app, replace /var/config.json with 
   data that will connect the react app with our socket server.
*/

class InterceptConfig : public RequestHandler
{
private:
    std::string response;
    uint64_t maxUploadSize;

public:
    InterceptConfig(int portNumber,uint64_t maxUploadSize)
        : RequestHandler("/var/config.json"),
          maxUploadSize(maxUploadSize)
    {
        std::stringstream s;

        s << "{ \"socket_server_port\": " << portNumber
          << ", \"socket_server_address\": \"*\", \"ui_plugins\": [ ], \"max_upload_size\": " << maxUploadSize << " }";
        response = s.str();
    }
    virtual ~InterceptConfig() {}

    virtual void head_response(
        const uri &request_uri,
        const boost::beast::http::request<boost::beast::http::string_body> &req,
        boost::beast::http::response<boost::beast::http::empty_body> &res,
        boost::beast::error_code &ec)
    {
        res.set(http::field::content_type, "application/json");
        res.set(http::field::cache_control, "no-cache");
        res.content_length(response.length());
        return;
    }

    virtual void get_response(
        const uri &request_uri,
        const boost::beast::http::request<boost::beast::http::string_body> &req,
        boost::beast::http::response<boost::beast::http::string_body> &res,
        boost::beast::error_code &ec)
    {
        res.set(http::field::content_type, "application/json");
        res.set(http::field::cache_control, "no-cache");
        res.content_length(response.length());
        res.body() = response;
    }
};

class ReactRedirector : public RequestHandler
{
    PiPedalConfiguration config;

public:
    ReactRedirector(const PiPedalConfiguration &config)
        : RequestHandler("/"),
          config(config)

    {
    }
    virtual ~ReactRedirector() {}

    virtual bool wantsRedirect(const uri &requestUri)
    {
        if (requestUri.segment_count() == 0 || (requestUri.segment_count() == 1 && requestUri.segment(0) == "index.htm"))
        {
            return true;
        }
        return false;
    }
    uri GetRedirect(const uri &requestUri)
    {
        return requestUri;
    }

    virtual bool wants(boost::beast::http::verb verb, const uri &request_uri) const
    {
        return false;
    }

    virtual void head_response(
        const uri &request_uri,
        const boost::beast::http::request<boost::beast::http::string_body> &req,
        boost::beast::http::response<boost::beast::http::empty_body> &res,
        boost::beast::error_code &ec)
    {
        ec = errc::make_error_code(errc::no_such_file_or_directory);
        return;
    }

    virtual void get_response(
        const uri &request_uri,
        const boost::beast::http::request<boost::beast::http::string_body> &req,
        boost::beast::http::response<boost::beast::http::string_body> &res,
        boost::beast::error_code &ec)
    {
        ec = errc::make_error_code(errc::no_such_file_or_directory);
    }
};

uint16_t g_ShutdownPort = 0;

int main(int argc, char *argv[])
{
    sem_init(&signalSemaphore, 0, 0);

    signal(SIGINT, sig_handler);

#ifndef WIN32
    umask(002); // newly created files in /var/pipedal get 775-ish permissions, which improves debugging/live-service interaction.
#endif

    // Check command line arguments.
    bool help = false;
    bool error = false;
    bool systemd = false;
    uint16_t shutdownPort = 0;
    std::string portOption;

    CommandLineParser parser;
    parser.AddOption("-h", &help);
    parser.AddOption("--help", &help);
    parser.AddOption("-systemd", &systemd);
    parser.AddOption("-port", &portOption);
    parser.AddOption("-shutdownPort", &shutdownPort);

    try
    {
        parser.Parse(argc, (const char **)argv);
        if (parser.Arguments().size() > 2)
        {
            throw PiPedalException("Too many arguments.");
        }
        if (parser.Arguments().size() == 0)
        {
            throw PiPedalException("<config_root> not provided.");
        }
        if (help || parser.Arguments().size() == 0)
        {
            std::cout << "pipedald - Pipedal web socket server.\n"
                         "Copyright (c) 2021 Robin Davies.\n"
                         "\n";
        }
    }
    catch (const std::exception &e)
    {
        std::cout << "Error: " << e.what() << "\n\n";
        error = true;
        help = true;
    }

    if (help)
    {
        std::cout << "Usage: pipedal <doc_root> [<web_root>] [options...]\n\n"
                  << "Options:\n"
                  << "   -systemd: Log to systemd journals.\n"
                  << "   -port: Port to listen on e.g. 0.0.0.0:80\n"
                  << "   -shutdownPort: Port for the shutdown service.\n"
                  << "Example:\n"
                  << "    pipedal /etc/pipedal/config /etc/pipedal/react -port 0.0.0.0:80 \n"
                     "\n"
                     "Description:\n\n"
                     "    Configuration is read from <doc_root>/config.json\n"
                     "\n"
                     "    If <web_root> is not provided, pipedal will serve from <doc_root>\n"
                     "\n"
                     "    While debugging, bind the port to 0.0.0.0:8080, and connect to the default React\n"
                     "    server that's provided when you run 'npm run start' in 'react/src'. By default, the\n"
                     "    React app will connect to the socket server on 0.0.0.0:8080.\n\n";
        return error ? EXIT_FAILURE : EXIT_SUCCESS;
    }

    g_ShutdownPort = shutdownPort;
    if (systemd)
    {
        Lv2Log::set_logger(MakeLv2SystemdLogger());
    }
    signal(SIGTERM, sig_handler);

    std::filesystem::path doc_root = parser.Arguments()[0];
    std::filesystem::path web_root = doc_root;
    if (parser.Arguments().size() >= 2)
    {
        web_root = parser.Arguments()[1];
    }

    PiPedalConfiguration configuration;
    try
    {
        configuration.Load(doc_root);
    }
    catch (const std::exception &e)
    {
        std::stringstream s;
        s << "Unable to read configuration from '" << (doc_root / "config.json") << "'. (" << e.what() << ")";
        Lv2Log::error(s.str());
        return EXIT_FAILURE;
    }

    Lv2Log::log_level(configuration.GetLogLevel());

    if (portOption.length() != 0)
    {
        configuration.SetSocketServerEndpoint(portOption);
    }

    uint16_t port;
    std::shared_ptr<BeastServer> server;
    try
    {
        auto const address = boost::asio::ip::make_address(configuration.GetSocketServerAddress());
        port = static_cast<uint16_t>(configuration.GetSocketServerPort());

        auto const threads = std::max<int>(1, configuration.GetThreads());

        server = std::make_shared<BeastServer>(
            address, port, web_root.c_str(), threads);

        Lv2Log::info("Document root: %s Threads: %d", doc_root.c_str(), (int)threads);

        server->SetLogHttpRequests(configuration.LogHttpRequests());

        boost::asio::ip::network_v4 gateway;
        if (configuration.GetAccessPointGateway(&gateway))
        {
            server->SetAccessPointGateway(gateway, configuration.GetAccessPointServerAddress());
        }
    }
    catch (const std::exception &e)
    {
        std::stringstream s;
        s << "Fatal error: " << e.what() << std::endl;
        Lv2Log::error(s.str());
        return EXIT_FAILURE;
    }

    try
    {
        PiPedalModel model;

        model.Load(configuration);

        auto pipedalSocketFactory = MakePiPedalSocketFactory(model);

        server->AddSocketFactory(pipedalSocketFactory);

        std::shared_ptr<RequestHandler> interceptConfig{new InterceptConfig(port,configuration.GetMaxUploadSize())};
        server->AddRequestHandler(interceptConfig);

        std::shared_ptr<DownloadIntercept> downloadIntercept = std::make_shared<DownloadIntercept>(&model);
        server->AddRequestHandler(downloadIntercept);

        server->RunInBackground();

        sem_wait(&signalSemaphore);

        Lv2Log::info("Shutting down gracefully.");
        model.Close();
        Lv2Log::info("Stopping web server.");
        server->Stop();
        server->Join();
        Lv2Log::info("Shutdown complete.");
    }
    catch (const std::exception &e)
    {
        Lv2Log::error(e.what());
    }
    Lv2Log::info("PiPedal terminating.");
    return EXIT_SUCCESS; // only exit in response to a signal.
}
