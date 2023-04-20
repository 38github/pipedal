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
#include "Lv2Effect.hpp"
#include "PiPedalException.hpp"
#include <lv2/lv2plug.in/ns/ext/worker/worker.h>
#include <lilv/lilv.h>
#include "lv2/atom.lv2/atom.h"
#include "lv2/atom.lv2/util.h"
#include "lv2.h"
#include "lv2/log.lv2/log.h"
#include "lv2/log.lv2/logger.h"
#include "lv2/midi.lv2/midi.h"
#include "lv2/urid.lv2/urid.h"
#include "lv2/log.lv2/logger.h"
#include "lv2/uri-map.lv2/uri-map.h"
#include "lv2/atom.lv2/forge.h"
#include "lv2/state.lv2/state.h"
#include "lv2/worker.lv2/worker.h"
#include "lv2/patch.lv2/patch.h"
#include "lv2/parameters.lv2/parameters.h"
#include "lv2/units.lv2/units.h"
#include "lv2/atom.lv2/util.h"
#include "AudioHost.hpp"
#include <exception>
#include "RingBufferReader.hpp"

using namespace pipedal;

const float BYPASS_TIME_S = 0.1f;

Lv2Effect::Lv2Effect(
    IHost *pHost_,
    const std::shared_ptr<Lv2PluginInfo> &info_,
    const PedalboardItem &pedalboardItem)
    : pHost(pHost_), pInstance(nullptr), info(info_), urids(pHost)
{
    auto pWorld = pHost_->getWorld();

    logFeature.Prepare(&(pHost_->GetMapFeature()),info_->name() + ": ",this);
    this->bypassStartingSamples = (uint32_t)(pHost->GetSampleRate() * BYPASS_TIME_S);

    this->bypass = pedalboardItem.isEnabled();

    // initialize the atom forge used on the realtime thread.
    LV2_URID_Map *map = this->pHost->GetLv2UridMap();
    lv2_atom_forge_init(&inputForgeRt, map);
    lv2_atom_forge_init(&outputForgeRt, map);

    const LilvPlugins *plugins = lilv_world_get_all_plugins(pWorld);

    auto uriNode = lilv_new_uri(pWorld, pedalboardItem.uri().c_str());
    const LilvPlugin *pPlugin = lilv_plugins_get_by_uri(plugins, uriNode);
    lilv_node_free(uriNode);

    LV2_Feature *const *features = pHost_->GetLv2Features();

    this->features.push_back(logFeature.GetFeature());

    for (auto p = features; *p != nullptr; ++p)
    {
        this->features.push_back(*p);
    }

    this->work_schedule_feature = nullptr;
    if (true) //info_->hasExtension(LV2_WORKER__interface))
    {
        // insane implementation. :-(
        LV2_Worker_Schedule *schedule = (LV2_Worker_Schedule *)malloc(sizeof(LV2_Worker_Schedule));
        schedule->handle = this;
        schedule->schedule_work = worker_schedule_fn;

        work_schedule_feature = (LV2_Feature *)malloc(sizeof(LV2_Feature));
        work_schedule_feature->URI = LV2_WORKER__schedule;
        work_schedule_feature->data = schedule;

        this->features.push_back(work_schedule_feature);
    }
    this->features.push_back(nullptr);

    const LV2_Feature **myFeatures = &this->features[0];

    LilvInstance *pInstance = nullptr;
    try {
        pInstance = lilv_plugin_instantiate(pPlugin, pHost->GetSampleRate(), myFeatures);
    } catch (const std::exception &e)
    {
        this->pInstance = nullptr;
        throw PiPedalException(SS("Plugin threw an exception: " << e.what() << " '" << info_->name() << "'"));

    }
    this->pInstance = pInstance;
    if (this->pInstance == nullptr)
    {
        throw PiPedalException(SS("Failed to create plugin \'" << info_->name() << "\'."));
    }

    const LV2_Worker_Interface *worker_interface =
        (const LV2_Worker_Interface *)lilv_instance_get_extension_data(pInstance,
                                                                        LV2_WORKER__interface);
    if (worker_interface) {
        this->worker = std::make_unique<Worker>(pHost->GetHostWorkerThread(), pInstance, worker_interface);
    }
    const LV2_State_Interface*state_interface = 
        (const LV2_State_Interface *)lilv_instance_get_extension_data(pInstance,
                                                                        LV2_STATE__interface);

    if (state_interface)
    {
        this->stateInterface = std::make_unique<StateInterface>(pHost,pInstance,state_interface);
    }

    this->instanceId = pedalboardItem.instanceId();

    this->controlValues.resize(info->ports().size());

    // Copy default pedalboard settings.
    for (auto i = pedalboardItem.controlValues().begin(); i != pedalboardItem.controlValues().end(); ++i)
    {
        auto &v = (*i);
        int index = GetControlIndex(v.key());
        if (index != -1)
        {
            this->controlValues[index] = v.value();
        }
    }
    PreparePortIndices();
    ConnectControlPorts();

    RestoreState(pedalboardItem);
}
void Lv2Effect::RestoreState(const PedalboardItem&pedalboardItem)
{
    // Restore state if present.
    if (this->stateInterface)
    {
        try {
            if (pedalboardItem.lv2State().isValid_)
            {
                this->stateInterface->Restore(pedalboardItem.lv2State());
            }
        } catch (const std::exception &e)
        {
            std::string name = pedalboardItem.pluginName();
            Lv2Log::warning(SS(name << ": " << e.what()));
        }
    }
}

void Lv2Effect::ConnectControlPorts()
{
    // shared_ptr is not thread-safe.
    // Get naked pointers to use on the realtime thread.
    int controlArrayLength = 0;
    for (int i = 0; i < info->ports().size(); ++i)
    {
        if (info->ports()[i]->index() >= controlArrayLength)
        {
            controlArrayLength = info->ports()[i]->index() + 1;
        }
    }
    this->realtimePortInfo.resize(controlArrayLength);
    for (int i = 0; i < info->ports().size(); ++i)
    {
        const auto &port = info->ports()[i];
        if (port->is_control_port())
        {
            int index = port->index();
            realtimePortInfo[index] = port.get();
            lilv_instance_connect_port(pInstance, i, &this->controlValues[index]);
        }
    }
}
void Lv2Effect::PreparePortIndices()
{

    for (int i = 0; i < info->ports().size(); ++i)
    {
        const auto &port = info->ports()[i];

        int portIndex = port->index();
        if (port->is_audio_port())
        {
            if (port->is_input())
            {
                this->inputAudioPortIndices.push_back(portIndex);
            }
            else
            {
                this->outputAudioPortIndices.push_back(portIndex);
            }
        }
        else if (port->is_atom_port())
        {
            if (port->is_input())
            {
                if (port->supports_midi())
                {
                    this->inputMidiPortIndices.push_back(portIndex);
                }
                this->inputAtomPortIndices.push_back(portIndex);
            }
            else
            {
                this->outputAtomPortIndices.push_back(portIndex);
                if (port->supports_midi())
                {
                    this->outputMidiPortIndices.push_back(portIndex);
                }
            }
        }
    }
    inputAudioBuffers.resize(inputAudioPortIndices.size());
    outputAudioBuffers.resize(outputAudioPortIndices.size());
    inputAtomBuffers.resize(inputAtomPortIndices.size());
    outputAtomBuffers.resize(outputAtomPortIndices.size());
}

void Lv2Effect::SetAudioInputBuffer(int index, float *buffer)
{
    if (index >= inputAudioPortIndices.size())
    {
        throw PiPedalArgumentException("Buffer index out of range.");
    }
    this->inputAudioBuffers[index] = buffer;
    int pluginIndex = this->inputAudioPortIndices[index];
    lilv_instance_connect_port(this->pInstance, pluginIndex, buffer);
}

void Lv2Effect::SetAudioInputBuffer(float *left)
{
    if (GetNumberOfInputAudioPorts() > 1)
    {
        SetAudioInputBuffer(0, left);
        SetAudioInputBuffer(1, left);
    }
    else
    {
        SetAudioInputBuffer(0, left);
    }
}

void Lv2Effect::SetAudioInputBuffers(float *left, float *right)
{
    if (GetNumberOfInputAudioPorts() == 1)
    {
        SetAudioInputBuffer(0, left);
    }
    else
    {
        SetAudioInputBuffer(0, left);
        SetAudioInputBuffer(1, right);
    }
}

void Lv2Effect::SetAudioOutputBuffer(int index, float *buffer)
{
    this->outputAudioBuffers[index] = buffer;
    int pluginIndex = this->outputAudioPortIndices[index];
    lilv_instance_connect_port(pInstance, pluginIndex, buffer);
}

int Lv2Effect::GetControlIndex(const std::string &key) const
{
    for (int i = 0; i < info->ports().size(); ++i)
    {
        auto &port = info->ports()[i];
        if (port->symbol() == key)
            return port->index();
    }
    return -1;
}

Lv2Effect::~Lv2Effect()
{
    if (worker)
    {
        worker->Close();
        worker = nullptr; // delete the worker first!
    }
    if (pInstance)
    {
        lilv_instance_free(pInstance);
        pInstance = nullptr;
    }
    if (work_schedule_feature)
    {
        free(work_schedule_feature->data);
        free(work_schedule_feature);
    }
}

void Lv2Effect::Activate()
{
    this->AssignUnconnectedPorts();
    lilv_instance_activate(pInstance);
    this->BypassTo(this->bypass ? 1.0f : 0.0f);


}


void Lv2Effect::AssignUnconnectedPorts()
{
    for (int i = 0; i < this->GetNumberOfInputAudioPorts(); ++i)
    {
        if (GetAudioInputBuffer(i) == nullptr)
        {
            int pluginIndex = this->inputAudioPortIndices[i];

            float *buffer = bufferPool.AllocateBuffer<float>(pHost->GetMaxAudioBufferSize());
            lilv_instance_connect_port(pInstance, pluginIndex, buffer);
        }
    }
    for (int i = 0; i < this->GetNumberOfOutputAudioPorts(); ++i)
    {
        if (GetAudioOutputBuffer(i) == nullptr)
        {
            int pluginIndex = this->outputAudioPortIndices[i];

            float *buffer = bufferPool.AllocateBuffer<float>(pHost->GetMaxAudioBufferSize());
            lilv_instance_connect_port(pInstance, pluginIndex, buffer);
        }
    }
    for (int i = 0; i < this->GetNumberOfInputAtomPorts(); ++i)
    {
        if (GetAtomInputBuffer(i) == nullptr)
        {
            int pluginIndex = this->inputAtomPortIndices[i];

            uint8_t *buffer = bufferPool.AllocateBuffer<uint8_t>(pHost->GetAtomBufferSize());
            lilv_instance_connect_port(pInstance, pluginIndex, buffer);
            ResetInputAtomBuffer((char *)buffer);
            this->inputAtomBuffers[i] = (char *)buffer;
        }
    }
    for (int i = 0; i < this->GetNumberOfOutputAtomPorts(); ++i)
    {
        if (GetAtomOutputBuffer(i) == nullptr)
        {
            int pluginIndex = this->outputAtomPortIndices[i];

            uint8_t *buffer = bufferPool.AllocateBuffer<uint8_t>(pHost->GetAtomBufferSize());
            ResetOutputAtomBuffer((char *)buffer);
            lilv_instance_connect_port(pInstance, pluginIndex, buffer);
            this->outputAtomBuffers[i] = (char *)buffer;
        }
    }
}
void Lv2Effect::Deactivate()
{
    if (worker)
    {
        worker->Close();
    }
    lilv_instance_deactivate(pInstance);
}

static inline void CopyBuffer(float *input, float *output, uint32_t frames)
{
    for (uint32_t i = 0; i < frames; ++i)
    {
        output[i] = input[i];
    }
}

void Lv2Effect::Run(uint32_t samples,RealtimeRingBufferWriter *realtimeRingBufferWriter)
{
    // close off the atom input frame.
    if (this->inputAtomBuffers.size() != 0)
    {
        lv2_atom_forge_pop(&this->inputForgeRt, &input_frame);
    }

    if (worker)
    {
        // relay worker response
        worker->EmitResponses();
    }
    lilv_instance_run(pInstance, samples);

    // do soft bypass.
    if (this->bypassSamplesRemaining == 0)
    {
        if (this->currentBypass == 0)
        {
            // replace the contents of the output buffer(s) with the input buffer(s).
            if (this->outputAudioBuffers.size() == 1)
            {
                CopyBuffer(this->inputAudioBuffers[0], this->outputAudioBuffers[0], samples);
            }
            else
            {
                if (this->inputAudioBuffers.size() == 1)
                {
                    CopyBuffer(this->inputAudioBuffers[0], this->outputAudioBuffers[0], samples);
                    CopyBuffer(this->inputAudioBuffers[0], this->outputAudioBuffers[1], samples);
                }
            }
        } // else leave the output alone.
    }
    else
    {
        double currentBypass = this->currentBypass;
        double currentBypassDx = this->currentBypassDx;
        int32_t bypassSamplesRemaining = (int)this->bypassSamplesRemaining;

        if (this->outputAudioBuffers.size() == 1)
        {
            float *input = this->inputAudioBuffers[0];
            float *output = this->outputAudioBuffers[0];
            for (uint32_t i = 0; i < samples; ++i)
            {
                output[i] = currentBypass * output[i] + (1 - currentBypass) * input[i];

                if (--bypassSamplesRemaining == 0)
                {
                    currentBypassDx = 0;
                    currentBypass = this->targetBypass;
                }
                currentBypass += currentBypassDx;
            }
        }
        else
        {
            float *inputL;
            float *inputR;
            if (this->inputAudioBuffers.size() == 1)
            {
                inputL = inputR = inputAudioBuffers[0];
            }
            else
            {
                inputL = inputAudioBuffers[0];
                inputR = inputAudioBuffers[1];
            }
            float *outputL = outputAudioBuffers[0];
            float *outputR = outputAudioBuffers[1];
            for (uint32_t i = 0; i < samples; ++i)
            {
                outputL[i] = currentBypass * outputL[i] + (1 - currentBypass) * inputL[i];
                outputR[i] = currentBypass * outputR[i] + (1 - currentBypass) * inputR[i];
                if (--bypassSamplesRemaining == 0)
                {
                    currentBypassDx = 0;
                    currentBypass = this->targetBypass;
                }
                currentBypass += currentBypassDx;
            }
        }
        if (bypassSamplesRemaining <= 0)
        {
            this->bypassSamplesRemaining = 0;
            this->currentBypass = this->targetBypass;
            this->currentBypassDx = 0;
        }
        else
        {
            this->currentBypass = currentBypass;
            this->currentBypassDx = currentBypassDx;
            this->bypassSamplesRemaining = bypassSamplesRemaining;
        }
        
    }
    RelayPatchSetMessages(this->instanceId,realtimeRingBufferWriter);
}

LV2_Worker_Status Lv2Effect::worker_schedule_fn(LV2_Worker_Schedule_Handle handle,
                                                uint32_t size,
                                                const void *data)
{
    Lv2Effect *this_ = (Lv2Effect *)handle;
    this_->worker->ScheduleWork(size, data);
    return LV2_WORKER_SUCCESS;
}

struct BufferHeader
{
    uint32_t size;
    uint32_t type;
};

void Lv2Effect::ResetInputAtomBuffer(char *data)
{
    BufferHeader *header = (BufferHeader *)data;
    header->size = sizeof(LV2_Atom_Sequence_Body);
    header->type = urids.atom__Sequence;
}
void Lv2Effect::ResetOutputAtomBuffer(char *data)
{
    BufferHeader *header = (BufferHeader *)data;
    header->size = pHost->GetAtomBufferSize() - 8;
    header->type = urids.atom__Chunk;
}

void Lv2Effect::BypassTo(float targetValue)
{
    this->targetBypass = targetValue;
    double dx = targetValue - this->currentBypass;
    if (dx != 0)
    {
        this->bypassSamplesRemaining = (int)(bypassStartingSamples * std::abs(dx));
        if (this->bypassStartingSamples == 0)
        {
            currentBypassDx = 0;
            this->currentBypass = targetBypass;
        }
        else
        {
            this->currentBypassDx = dx / this->bypassSamplesRemaining;
        }
    }
}

void Lv2Effect::ResetAtomBuffers()
{
    for (size_t i = 0; i < this->inputAtomBuffers.size(); ++i)
    {
        ResetInputAtomBuffer(this->inputAtomBuffers[i]);
    }
    for (size_t i = 0; i < this->outputAtomBuffers.size(); ++i)
    {
        ResetOutputAtomBuffer(this->outputAtomBuffers[i]);
    }
    if (inputAtomBuffers.size() != 0)
    {
        const uint32_t notify_capacity = pHost->GetAtomBufferSize();
        lv2_atom_forge_set_buffer(
            &(this->inputForgeRt), (uint8_t *)(this->inputAtomBuffers[0]), notify_capacity);

        // Start a sequence in the notify input port.

        lv2_atom_forge_sequence_head(&this->inputForgeRt, &input_frame, urids.units__frame);
    }
}

void Lv2Effect::RequestPatchProperty(LV2_URID uridUri)
{
    lv2_atom_forge_frame_time(&inputForgeRt, 0);

    LV2_Atom_Forge_Frame objectFrame;
    LV2_Atom_Forge_Ref set =
        lv2_atom_forge_object(&inputForgeRt, &objectFrame, 0, urids.patch__Get);

    lv2_atom_forge_key(&inputForgeRt, urids.patch__property);
    lv2_atom_forge_urid(&inputForgeRt, uridUri);
    lv2_atom_forge_pop(&inputForgeRt, &objectFrame);
}
void Lv2Effect::SetPatchProperty(LV2_URID uridUri,size_t size, LV2_Atom*value)
{
    lv2_atom_forge_frame_time(&inputForgeRt, 0);

    LV2_Atom_Forge_Frame objectFrame;
    LV2_Atom_Forge_Ref set =
        lv2_atom_forge_object(&inputForgeRt, &objectFrame, 0, urids.patch__Set);
    {
        lv2_atom_forge_key(&inputForgeRt, urids.patch__property);
        lv2_atom_forge_urid(&inputForgeRt, uridUri);
        lv2_atom_forge_key(&inputForgeRt, urids.patch__value);
        lv2_atom_forge_write(&inputForgeRt,value,size);
    }

    lv2_atom_forge_pop(&inputForgeRt, &objectFrame);
}


void Lv2Effect::RelayPatchSetMessages(uint64_t instanceId,RealtimeRingBufferWriter *realtimeRingBufferWriter)
{
    LV2_Atom_Sequence*controlOutput = (LV2_Atom_Sequence*)GetAtomOutputBuffer();
    if (controlOutput == nullptr)
    {
        return;
    }

    bool stateChanged = false;
    LV2_ATOM_SEQUENCE_FOREACH(controlOutput, ev)
    {

        // frame_offset = ev->time.frames;  // not really interested.

        if (lv2_atom_forge_is_object_type(&this->outputForgeRt, ev->body.type))
        {
            const LV2_Atom_Object *obj = (const LV2_Atom_Object *)&ev->body;
            if (obj->body.otype == urids.state__StateChanged)
            {
                stateChanged = true;
            } else if (obj->body.otype == urids.patch__Set) // patch_Set is handled elsewhere.
            {
                realtimeRingBufferWriter->AtomOutput(instanceId,obj->atom.size +sizeof(obj->atom),(uint8_t*)obj);
            }
        }
        if (stateChanged)
        {
            realtimeRingBufferWriter->Lv2StateChanged(instanceId);
        }
    }
}

void Lv2Effect::GatherPatchProperties(RealtimePatchPropertyRequest *pRequest)
{
    if (pRequest->requestType == RealtimePatchPropertyRequest::RequestType::PatchGet)
    {
        LV2_Atom_Sequence*controlInput = (LV2_Atom_Sequence*)GetAtomOutputBuffer();
        if (controlInput == nullptr) 
        {
            return;
        }
        LV2_ATOM_SEQUENCE_FOREACH(controlInput, ev)
        {

            auto frame_offset = ev->time.frames;  // not really interested.

            if (lv2_atom_forge_is_object_type(&this->outputForgeRt, ev->body.type))
            {
                const LV2_Atom_Object *obj = (const LV2_Atom_Object *)&ev->body;
                if (obj->body.otype == urids.patch__Set)
                {
                    // Get the property and value of the set message
                    const LV2_Atom *property = NULL;
                    const LV2_Atom *value = NULL;

                    lv2_atom_object_get(
                        obj,
                        urids.patch__property, &property,
                        urids.patch__value, &value,
                        0);

                    if (property && property->type == urids.atom__URID && value)
                    {
                        LV2_URID key = ((const LV2_Atom_URID *)property)->body;
                        if (key == pRequest->uridUri)
                        {
                            int atom_size = value->size + sizeof(LV2_Atom);
                            pRequest->SetSize(atom_size);
                            memcpy(pRequest->GetBuffer(),value,atom_size);
                            break;
                        }
                    }
                }
            }
        }
    }
}
bool Lv2Effect::GetLv2State(Lv2PluginState*state)
{
    if (!this->stateInterface) return false;
    try {
        if (this->stateInterface == nullptr)
        {
            state->Erase();
            return false;
        }
        *state = this->stateInterface->Save();
        state->isValid_ = true;
        return true;
    }
    catch (const std::exception&e)
    {
        state->Erase();
        throw;
    }
}


void Lv2Effect::OnLogError(const char*message)
{
    // only errors get transmitted to the client.
    strncpy(this->errorMessage,message,sizeof(errorMessage));
    errorMessage[sizeof(errorMessage)-1] = '\0';
    this->hasErrorMessage = true;
}

void Lv2Effect::OnLogWarning(const char*message)
{
    Lv2Log::warning(message);

}
void Lv2Effect::OnLogInfo(const char*message)
{
    Lv2Log::info(message);

}
void Lv2Effect::OnLogDebug(const char*message)
{
    Lv2Log::debug(message);

}


