// Copyright (c) 2022 Robin Davies
//
// Permission is hereby granted, free of charge, to any person obtaining a copy of
// this software and associated documentation files (the "Software"), to deal in
// the Software without restriction, including without limitation the rights to
// use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
// the Software, and to permit persons to whom the Software is furnished to do so,
// subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
// FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
// COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
// IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
// CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

#include "pch.h"
#include "config.hpp"
#include "PiPedalVersion.hpp"

#ifdef _WIN32
#include "windows.h"
#include "sstream"
#else
#include <sys/utsname.h>
#endif

using namespace pipedal;

JSON_MAP_BEGIN(PiPedalVersion)
    JSON_MAP_REFERENCE(PiPedalVersion,server)
    JSON_MAP_REFERENCE(PiPedalVersion,serverVersion)
    JSON_MAP_REFERENCE(PiPedalVersion,operatingSystem)
    JSON_MAP_REFERENCE(PiPedalVersion,osVersion)
    JSON_MAP_REFERENCE(PiPedalVersion,debug)
JSON_MAP_END()

PiPedalVersion::PiPedalVersion()
{
    server_ = "PiPedal Server";
    // defined on build command line.
    serverVersion_ = PROJECT_DISPLAY_VERSION;
#ifdef _WIN32 
   OSVERSIONINFOEXA info;
    ZeroMemory(&info, sizeof(OSVERSIONINFOEA));
    info.dwOSVersionInfoSize = sizeof(OSVERSIONINFOEA);

    GetVersionExA(&info);

    ::stringstream s;
    s << info.dwMajorVersion << '.' << info.dwMinorVersion << '.' << info.dwBuildNumber;
    #ifdef _WIN32
    operatingSystem_ = "Windows 32-bit";
    #elif _WIN64
    operatingSystem_ = "Windows 64-bit";
    #endif
    osVersion_ = s.str();
#else
    struct utsname uts;
    uname(&uts);
    operatingSystem_ = uts.sysname;

    osVersion_ = std::string(uts.release) + "/"+ std::string(uts.machine);
#endif

#ifdef DEBUG
    debug_ = true;
#else
    debug_ = false;
#endif
}
