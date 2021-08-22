#include "pch.h"
#include "SystemConfigFile.hpp"
#include "PiPedalException.hpp"
#include <fstream>
#include <string>
#include <regex>

using namespace pipedal;
using namespace std;

void SystemConfigFile::Load(const boost::filesystem::path&path)
{
    this->lines.clear();

    ifstream f(path);
    if (!f.is_open())
    {
        stringstream s;
        s << "File not found: " << path;
        throw PiPedalException(s.str());
    }

    while (true)
    {
        std::string line;
        std::getline(f,line);
        if (f.fail())
        {
            break;
        }
        lines.push_back(line);
    }
    this->currentPath = path;


}

int64_t SystemConfigFile::GetLine(const std::string &key) const
{
    for (size_t i = 0; i < lines.size(); ++i)
    {
        if (LineMatches(lines[i],key)) 
        {
            return i;
        }
    }
    return -1;
}

bool SystemConfigFile::HasValue(const std::string&key) const
{
    return GetLine(key) != -1;
}

static inline std::string ValuePart(const std::string &line)
{
    auto pos = line.find('=');
    if (pos == std::string::npos) throw PiPedalException("Value not found.");
    return line.substr(pos+1);

}
std::string SystemConfigFile::Get(const std::string&key) const
{
    int64_t lineIndex = GetLine(key);
    if (lineIndex == -1) throw PiPedalArgumentException("Not found.");
    return ValuePart(lines[lineIndex]);

}

bool SystemConfigFile::Get(const std::string&key,std::string*pResult) const
{
    int64_t lineIndex = GetLine(key);
    if (lineIndex == -1) return false;
    *pResult = ValuePart(lines[lineIndex]);
    return true;
}
void SystemConfigFile::Set(const std::string&key,const std::string &value)
{
    stringstream s;
    s << key << "=" << value;
    std::string line = s.str();
    int lineIndex = GetLine(key);
    if (lineIndex != -1) {
        lines[lineIndex] = line;
    } else {
        lines.push_back(line);
    }
}

bool SystemConfigFile::Erase(const std::string&key)
{
    bool matched = false;
    for (size_t i = 0; i < lines.size(); ++i)
    {
        if (LineMatches(lines[i],key))
        {
            matched = true;
            lines.erase(lines.begin()+i);
            --i;
        }
    }
    return matched;

}

static std::string makeLine(const std::string&key, const std::string&value) {
    stringstream s;
    s << key << "=" << value;
    return s.str();
}
int64_t SystemConfigFile::Insert(int64_t position, const std::string&key, const std::string&value)
{
    if (position < 0 || position >= lines.size())
    {
        lines.push_back(makeLine(key,value));
        return (int64_t)lines.size();
    } else {
        lines.insert(lines.begin()+position,makeLine(key,value));
        return position+1;
    }
}
int64_t SystemConfigFile::Insert(int64_t position, const std::string&line)
{
    if (position < 0 || position >= lines.size())
    {
        lines.push_back(line);
        return (int64_t)lines.size();
    } else {
        lines.insert(lines.begin()+position,line);
        return position+1;
    }
}

bool SystemConfigFile::LineMatches(const std::string &line, const std::string&key) const
{
    // (very permissive interpretation)
    int pos = 0;
    while (pos < line.length() && (line[pos] == ' ' || line[pos] == '\t'))
    {
        ++pos;
    }
    if (line.compare(pos,pos+key.length(),key) != 0) return false;
    pos += key.length();\
    while (pos < line.length() && (line[pos] == ' ' || line[pos] == '\t'))
    {
        ++pos;
    }
    return pos < line.length() && line[pos] == '=';
}

void SystemConfigFile::SetLine(int64_t lineIndex,const std::string&key,const std::string &value )
{
    stringstream s;
    s << key << "=" << value;
    if (lineIndex >= 0 && lineIndex < this->lines.size())
    {
        this->lines[lineIndex] = s.str();
    } else {
        this->lines.push_back(s.str());
    }
}

void SystemConfigFile::Set(const std::string&key,const std::string &value, bool overwrite)
{
    if (!overwrite)
    {
        if (HasValue(key)) return;
    }
    Set(key,value);
}

void SystemConfigFile::Set(const std::string&key,const std::string &value, const std::string&comment)
{
    uint64_t lineIndex = GetLine(key);
    if (lineIndex != -1) 
    {
        SetLine(lineIndex, key, value);
    } else {
        lines.push_back("");
        lines.push_back("# " + comment);
        SetLine(-1,key,value);
    }
}

void SystemConfigFile::Save(std::ostream &os)
{
    for (int i = 0; i < lines.size(); ++i)
    {
        os << lines[i] << std::endl;
    }

}
void SystemConfigFile::Save(const boost::filesystem::path&path)
{
    ofstream f(path);

    if (!f.is_open()) {
        stringstream s;
        s << "Unable to write to " << path;
        throw PiPedalException(s.str());
    }
    Save(f);
    if (f.fail())
    {
        stringstream s;
        s << "Unable to write to " << path;
        throw PiPedalException(s.str());
    }
}
void SystemConfigFile::Save()
{
    Save(this->currentPath);
}
