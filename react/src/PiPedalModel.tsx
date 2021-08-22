import { UiPlugin, UiControl, PluginType } from './Lv2Plugin';

import { PiPedalArgumentError, PiPedalStateError } from './PiPedalError';

import { ObservableProperty } from './ObservableProperty';
import { PedalBoard, ControlValue } from './PedalBoard'
import PluginClass from './PluginClass';
import PiPedalSocket, { PiPedalMessageHeader } from './PiPedalSocket';
import { nullCast } from './Utility'
import { JackConfiguration, JackChannelSelection } from './Jack';
import { BankIndex } from './Banks';
import JackHostStatus from './JackHostStatus';
import JackServerSettings from './JackServerSettings';
import MidiBinding from './MidiBinding';
import PluginPreset from './PluginPreset';
import WifiConfigSettings from './WifiConfigSettings';
import WifiChannel from './WifiChannel';


export enum State {
    Loading,
    Ready,
    Error,
    Reconnecting
};


export interface VuUpdateInfo {
    instanceId: number;

    sampleTime: number; // in samples.
    isStereoInput: boolean;
    isStereoOutput: boolean;
    inputMaxValueL: number;
    inputMaxValueR: number;
    outputMaxValueL: number;
    outputMaxValueR: number;
};

export interface MonitorPortHandle {

};

class MidiEventListener {
    constructor(handle: number, callback: (isNote: boolean, noteOrControl: number) => void) {
        this.handle = handle;
        this.callback = callback;
    }
    handle: number;
    callback: (isNote: boolean, noteOrControl: number) => void;
};

export interface ListenHandle {
    _handle: number;
}
class MonitorPortHandleImpl implements MonitorPortHandle {
    constructor(instanceId: number, key: string, onUpdated: (value: number) => void) {
        this.instanceId = instanceId;
        this.key = key;
        this.onUpdated = onUpdated;
    }
    valid: boolean = true;
    subscriptionHandle?: number;

    instanceId: number;
    key: string;
    onUpdated: (value: number) => void

};

export interface VuSubscriptionHandle {

};

class VuSubscriptionHandleImpl implements VuSubscriptionHandle {
    constructor(instanceId_: number, callback_: VuChangedHandler) {
        this.instanceId = instanceId_;
        this.callback = callback_;
    }
    instanceId: number;
    callback: VuChangedHandler;
};

export type VuChangedHandler = (vuInfo: VuUpdateInfo) => void;


class VuSubscriptionTarget {
    serverSubscriptionHandle?: number;
    subscribers: VuSubscriptionHandleImpl[] = [];
};

export type PiPedalVersion = {
    server: string;
    serverVersion: string;
    operatingSystem: string;
    osVersion: string;
    debug: boolean;
};

export class PresetIndexEntry {
    deserialize(input: any): PresetIndexEntry {
        this.instanceId = input.instanceId;
        this.name = input.name;
        return this;
    }
    static deserialize_array(input: any): PresetIndexEntry[] {
        let result: PresetIndexEntry[] = [];
        for (let i = 0; i < input.length; ++i) {
            result[i] = new PresetIndexEntry().deserialize(input[i]);
        }
        return result;
    }
    instanceId: number = 0;
    name: string = "";

    areEqual(other: PresetIndexEntry): boolean {
        return (
            (this.instanceId === other.instanceId)
            && this.name === other.name
        );
    }
};

export class PresetIndex {
    deserialize(input: any): PresetIndex {
        this.selectedInstanceId = input.selectedInstanceId;
        this.presetChanged = input.presetChanged;
        this.presets = PresetIndexEntry.deserialize_array(input.presets);
        return this;
    }
    selectedInstanceId: number = 0;
    presetChanged: boolean = false;
    presets: PresetIndexEntry[] = [];

    clone(): PresetIndex {
        return new PresetIndex().deserialize(this);
    }
    areEqual(other: PresetIndex, includeSelectedInstance: boolean): boolean {
        if (includeSelectedInstance && this.selectedInstanceId !== other.selectedInstanceId) return false;
        if (this.presets.length !== other.presets.length) return false;
        for (let i = 0; i < this.presets.length; ++i) {
            if (!this.presets[i].areEqual(other.presets[i])) return false;
        }
        return true;
    }
    getItem(instanceId: number): PresetIndexEntry | null {
        for (let i = 0; i < this.presets.length; ++i) {
            if (this.presets[i].instanceId === instanceId) {
                return this.presets[i];
            }
        }
        return null;
    }
    getSelectedText(): string {
        let item = this.getItem(this.selectedInstanceId);
        if (item === null) return "";

        if (this.presetChanged) {
            return item.name + " *";
        } else {
            return item.name;
        }
    }
    addItem(instanceId: number, name: string): number {
        let newItem: PresetIndexEntry = new PresetIndexEntry();
        newItem.instanceId = instanceId;
        newItem.name = name;
        this.presets.push(newItem);
        return newItem.instanceId;
    }
    movePreset(from: number, to: number) {
        let newElements = this.presets;
        let t = newElements[from];
        newElements.splice(from, 1);
        newElements.splice(to, 0, t);

    }
    deleteItem(instanceId: number): number {
        for (let i = 0; i < this.presets.length; ++i) {
            let preset = this.presets[i];
            if (preset.instanceId === instanceId) {
                this.presets.splice(i, 1);
                if (i < this.presets.length) {
                    return this.presets[i].instanceId;
                } else {
                    if (i - 1 > 0) {
                        return this.presets[i - 1].instanceId;
                    } else {
                        return -1;
                    }
                }
            }
        }
        return -1;

    }


}

interface MonitorPortOutputBody {
    subscriptionHandle: number;
    value: number;
}


interface ChannelSelectionChangedBody {
    clientId: number;
    jackChannelSelection: JackChannelSelection;
}
interface RenamePresetBody {
    clientId: number;
    instanceId: number;
    name: string;
}

interface PresetsChangedBody {
    clientId: number,
    presets: PresetIndex
}
interface PedalBoardItemEnableBody {
    clientId: number,
    instanceId: number,
    enabled: boolean
}
interface PedalBoardChangedBody {
    clientId: number;
    pedalBoard: PedalBoard;
}
interface ControlChangedBody {
    clientId: number;
    instanceId: number;
    symbol: string;
    value: number;
};


export interface PiPedalModel {
    clientId: number;
    countryCodes: Object;
    serverVersion?: PiPedalVersion;
    errorMessage: ObservableProperty<string>;
    alertMessage: ObservableProperty<string>;
    state: ObservableProperty<State>;
    ui_plugins: ObservableProperty<UiPlugin[]>;
    plugin_classes: ObservableProperty<PluginClass>;
    jackConfiguration: ObservableProperty<JackConfiguration>;
    jackSettings: ObservableProperty<JackChannelSelection>;
    banks: ObservableProperty<BankIndex>;
    jackServerSettings: ObservableProperty<JackServerSettings>;
    wifiConfigSettings: ObservableProperty<WifiConfigSettings>;

    presets: ObservableProperty<PresetIndex>;

    setJackServerSettings(jackServerSettings: JackServerSettings): void;
    setMidiBinding(instanceId: number, midiBinding: MidiBinding): void;


    getUiPlugin(uri: string): UiPlugin | null;

    pedalBoard: ObservableProperty<PedalBoard>;
    loadPedalBoardPlugin(itemId: number, selectedUri: string): number;

    setPedalBoardControlValue(instanceId: number, key: string, value: number): void;
    setPedalBoardItemEnabled(instanceId: number, value: boolean): void;
    previewPedalBoardValue(instanceId: number, key: string, value: number): void;
    setPedalBoardControlValue(instanceId: number, key: string, value: number): void;
    deletePedalBoardPedal(instanceId: number): number | null;

    movePedalBoardItem(fromInstanceId: number, toInstanceId: number): void;
    movePedalBoardItemToStart(fromInstanceId: number): void;
    movePedalBoardItemToEnd(fromInstanceId: number): void;
    movePedalBoardItemBefore(fromInstanceId: number, toInstanceId: number): void;
    movePedalBoardItemAfter(fromInstanceId: number, toInstanceId: number): void;

    addPedalBoardItem(instanceId: number, append: boolean): number;
    addPedalBoardSplitItem(instanceId: number, append: boolean): number;
    setPedalBoardItemEmpty(instanceId: number): number;

    saveCurrentPreset(): void;
    saveCurrentPresetAs(newName: string): void;

    loadPreset(instanceId: number): void;
    updatePresets(presets: PresetIndex): Promise<void>;
    deletePresetItem(instanceId: number): Promise<number>;
    renamePresetItem(instanceId: number, name: string): Promise<void>;
    copyPreset(fromId: number, toId: number): Promise<number>;
    duplicatePreset(instanceId: number): Promise<number>;

    moveBank(from: number, to: number): Promise<void>;
    deleteBankItem(instanceId: number): Promise<number>;


    showAlert(message: string): void;

    setJackSettings(jackSettings: JackChannelSelection): void;

    svgImgUrl(svgImage: string): string;

    removeVuSubscription(handle: VuSubscriptionHandle): void;
    addVuSubscription(instanceId: number, vuChangedHandler: VuChangedHandler): VuSubscriptionHandle;

    monitorPort(instanceid: number, key: string, updateRateSeconds: number, onUpdated: (value: number) => void): MonitorPortHandle;
    unmonitorPort(handle: MonitorPortHandle): void;

    getLv2Parameter<Type = any>(instanceId: number, uri: string): Promise<Type>;

    renameBank(instanceId: number, newName: string): Promise<void>;
    saveBankAs(instanceId: number, newName: string): Promise<number>;
    openBank(bankId: number): Promise<void>;

    getJackStatus(): Promise<JackHostStatus>;

    getPluginPresets(uri: string): Promise<PluginPreset[]>;
    loadPluginPreset(instanceId: number, presetName: string): void;

    shutdown(): Promise<void>;
    restart(): Promise<void>;

    listenForMidiEvent(listenForControlsOnly: boolean, onComplete: (isNote: boolean, noteOrControl: number) => void): ListenHandle;
    cancelListenForMidiEvent(listenHandle: ListenHandle): void;

    download(targetType: string, isntanceId: number): void;

    uploadPreset(file: File, uploadAfter: number): Promise<number>;

    setWifiConfigSettings(wifiConfigSettings: WifiConfigSettings): Promise<void>;

    getWifiChannels(countryIso3661: string): Promise<WifiChannel[]>;

};

class PiPedalModelImpl implements PiPedalModel {
    clientId: number = -1;

    serverVersion?: PiPedalVersion;
    countryCodes: Object = {};
    socketServerUrl: string = "";
    varServerUrl: string = "";
    lv2Path: string = "";
    webSocket?: PiPedalSocket;

    ui_plugins: ObservableProperty<UiPlugin[]>
        = new ObservableProperty<UiPlugin[]>([]);
    state: ObservableProperty<State> = new ObservableProperty<State>(State.Loading);
    errorMessage: ObservableProperty<string> = new ObservableProperty<string>("");
    alertMessage: ObservableProperty<string> = new ObservableProperty<string>("");
    pedalBoard: ObservableProperty<PedalBoard> = new ObservableProperty<PedalBoard>(new PedalBoard());
    plugin_classes: ObservableProperty<PluginClass> = new ObservableProperty<PluginClass>(new PluginClass());
    jackConfiguration: ObservableProperty<JackConfiguration> = new ObservableProperty<JackConfiguration>(new JackConfiguration());
    jackSettings: ObservableProperty<JackChannelSelection> = new ObservableProperty<JackChannelSelection>(new JackChannelSelection());
    banks: ObservableProperty<BankIndex>
        = new ObservableProperty<BankIndex>(new BankIndex());
    jackServerSettings: ObservableProperty<JackServerSettings>
        = new ObservableProperty<JackServerSettings>(new JackServerSettings());

    wifiConfigSettings: ObservableProperty<WifiConfigSettings> = new ObservableProperty<WifiConfigSettings>(new WifiConfigSettings());


    presets: ObservableProperty<PresetIndex> = new ObservableProperty<PresetIndex>
        (
            new PresetIndex()
        );


    svgImgUrl(svgImage: string): string {
        //return this.varServerUrl + "img/" + svgImage;
        return "img/" + svgImage;
    }


    getUiPlugin(uri: string): UiPlugin | null {
        let plugins: UiPlugin[] = this.ui_plugins.get();

        for (let plugin of plugins) {
            if (plugin.uri === uri) return plugin;
        }
        return null;
    }


    constructor() {
        this.onSocketError = this.onSocketError.bind(this);
        this.onSocketMessage = this.onSocketMessage.bind(this);
        this.onSocketReconnecting = this.onSocketReconnecting.bind(this);
        this.onSocketReconnected = this.onSocketReconnected.bind(this);
    }
    onSocketReconnecting(retry: number, maxRetries: number): void {
        if (retry !== 0) {
            this.setState(State.Reconnecting);
        }
    }


    onSocketError(errorMessage: string, exception: any) {
        this.onError(errorMessage);
    }
    onSocketMessage(header: PiPedalMessageHeader, body?: any) {
        let message = header.message;
        if (message === "onMonitorPortOutput") {
            let monitorPortOutputBody = body as MonitorPortOutputBody;
            for (let i = 0; i < this.monitorPortSubscriptions.length; ++i) {
                let subscription = this.monitorPortSubscriptions[i];
                if (subscription.subscriptionHandle === monitorPortOutputBody.subscriptionHandle) {
                    subscription.onUpdated(body.value);
                    break;
                }
            }
            if (header.replyTo) {
                this.webSocket?.reply(header.replyTo, "onMonitorPortOutput", true);
            }

        } else if (message === "onChannelSelectionChanged") {
            let channelSelectionBody = body as ChannelSelectionChangedBody;
            let channelSelection = new JackChannelSelection().deserialize(channelSelectionBody.jackChannelSelection);
            this.jackSettings.set(channelSelection);
        } else if (message === "onPresetsChanged") {
            let presetsChangedBody = body as PresetsChangedBody;
            let presets = new PresetIndex().deserialize(presetsChangedBody.presets);
            this.presets.set(presets);
        } else if (message === "onJackConfigurationChanged") {
            this.jackConfiguration.set(new JackConfiguration().deserialize(body));
        } else if (message === "onLoadPluginPreset") {
            let instanceId = body.instanceId as number;
            let controlValues = ControlValue.deserializeArray(body.controlValues);
            this.handleOnLoadPluginPreset(instanceId, controlValues);
        } else if (message === "onItemEnabledChanged") {
            let itemEnabledBody = body as PedalBoardItemEnableBody;
            this._setPedalBoardItemEnabled(
                itemEnabledBody.instanceId,
                itemEnabledBody.enabled,
                false  // No server notification.
            );
        } else if (message === "onPedalBoardChanged") {
            let pedalChangedBody = body as PedalBoardChangedBody;
            // xxx: do we want to optimize for messages we went ourselves??
            // we could actually protect against preview collisions in the model.
            this.pedalBoard.set(new PedalBoard().deserialize(pedalChangedBody.pedalBoard));

        } else if (message === "onMidiValueChanged") {
            let controlChangedBody = body as ControlChangedBody;
            // xxx: do we want to optimize for messages we went ourselves??
            // we could actually protect against preview collisions in the model.
            this._setPedalBoardControlValue(
                controlChangedBody.instanceId,
                controlChangedBody.symbol,
                controlChangedBody.value,
                false // do NOT notify the server of the change.
            );
            if (header.replyTo) {
                this.webSocket?.reply(header.replyTo, "onMidiValueChanged", true);
            }

        } else if (message === "onNotifyMidiListener") {
            let clientHandle = body.clientHandle as number;
            let isNote = body.isNote as boolean;
            let noteOrControl = body.noteOrControl as number;
            this.handleNotifyMidiListener(clientHandle, isNote, noteOrControl);
        } else if (message === "onControlChanged") {
            let controlChangedBody = body as ControlChangedBody;
            // xxx: do we want to optimize for messages we went ourselves??
            // we could actually protect against preview collisions in the model.
            this._setPedalBoardControlValue(
                controlChangedBody.instanceId,
                controlChangedBody.symbol,
                controlChangedBody.value,
                false // do NOT notify the server of the change.
            );
        } else if (message === "onJackServerSettingsChanged") {
            let jackServerSettings = new JackServerSettings().deserialize(body);
            this.jackServerSettings.set(jackServerSettings);
        } else if (message === "onWifiConfigSettingsChanged") {
            let wifiConfigSettings = new WifiConfigSettings().deserialize(body);
            this.wifiConfigSettings.set(wifiConfigSettings);
        } else if (message === "onBanksChanged") {
            let banks = new BankIndex().deserialize(body);
            this.banks.set(banks);
        } else if (message === "onVuUpdate") {
            let vuUpdate = body as VuUpdateInfo;
            let item = this.vuSubscriptions[vuUpdate.instanceId];
            if (item) {
                for (let i = 0; i < item.subscribers.length; ++i) {
                    item.subscribers[i].callback(vuUpdate);
                }
            }
            if (header.replyTo) {
                this.webSocket?.reply(header.replyTo, "onVuUpdate", true);
            }

        } else {
            throw new PiPedalStateError("Unrecognized message received from server.");
        }
    }
    setError(message: string): void {
        this.errorMessage.set(message);
        this.setState(State.Error);
    }
    varRequest(url: string): string {
        return "var/" + url;
    }

    setState(state: State) {
        if (this.state.get() !== state) {
            this.state.set(state);
        }
    }

    validatePlugins(plugin: PluginClass) {
        if (plugin.plugin_type === PluginType.None) {
            console.log("Error: No plugin type for uri '" + plugin.uri + "'");
        }
        for (let i = 0; i < plugin.children.length; ++i) {
            this.validatePlugins(plugin.children[i]);
        }
    }

    requestPluginClasses(): Promise<boolean> {
        const myRequest = new Request(this.varRequest('plugin_classes.json'));
        return fetch(myRequest)
            .then(
                response => response.json()
            )
            .then(data => {
                let plugins = new PluginClass().deserialize(data);

                this.validatePlugins(plugins);
                this.plugin_classes.set(plugins);
                return true;
            })
            .catch((error) => {
                this.setError("Can't contact server.\n\n" + error);
                return false;
            });

    }
    getWebSocket(): PiPedalSocket {
        if (this.webSocket === undefined) {
            throw new PiPedalStateError("Attempt to access web socket before it's connected.");
        }
        return this.webSocket;
    }

    onSocketReconnected() {
        // reload state, but not configuration.
        this.getWebSocket().request<number>("hello")
            .then(clientId => {
                this.clientId = clientId;
                return this.getWebSocket().request<PedalBoard>("currentPedalBoard");
            })
            .then(data => {
                this.pedalBoard.set(new PedalBoard().deserialize(data));

                return this.getWebSocket().request<any>("getWifiConfigSettings");
            })
            .then(data => {
                this.wifiConfigSettings.set(new WifiConfigSettings().deserialize(data));

                return this.getWebSocket().request<any>("getJackServerSettings");
            })
            .then(data => {
                this.jackServerSettings.set(new JackServerSettings().deserialize(data));

                return this.getWebSocket().request<PresetIndex>("getPresets");
            })
            .then((data) => {
                this.presets.set(new PresetIndex().deserialize(data));

                return this.getWebSocket().request<JackConfiguration>("getJackConfiguration");
            })
            .then((data) => {
                // data.isValid = false;
                // data.errorState = "Jack Audio server not running."

                this.jackConfiguration.set(new JackConfiguration().deserialize(data));

                return this.getWebSocket().request<any>("getJackSettings");
            })
            .then((data) => {
                this.jackSettings.set(new JackChannelSelection().deserialize(data));

                return this.getWebSocket().request<any>("getBankIndex");
            })
            .then((data) => {
                this.banks.set(new BankIndex().deserialize(data));


                this.setState(State.Ready);
            })
            .catch((what) => {
                this.onError(what);
            })
    }
    makeSocketServerUrl(hostName: string, port: number): string {
        return "ws://" + hostName + ":" + port + "/pipedal";

    }
    makeVarServerUrl(protocol: string, hostName: string, port: number): string {
        return protocol + "://" + hostName + ":" + port + "/var/";

    }

    maxUploadSize: number = 512 * 1024;

    requestConfig(): Promise<boolean> {
        const myRequest = new Request(this.varRequest('config.json'));
        return fetch(myRequest)
            .then(
                (response) => {
                    return response.json();
                }
            )
            .then(data => {
                if (data.max_upload_size) {
                    this.maxUploadSize = data.max_upload_size;
                }
                let { socket_server_port, socket_server_address } = data;
                if ((!socket_server_address) || socket_server_address === "*") {
                    socket_server_address = window.location.hostname;
                }
                if (!socket_server_port) socket_server_port = 8080;
                let socket_server = this.makeSocketServerUrl(socket_server_address, socket_server_port);
                let var_server_url = this.makeVarServerUrl("http", socket_server_address, socket_server_port);


                this.socketServerUrl = socket_server;
                this.varServerUrl = var_server_url;

                this.webSocket = new PiPedalSocket(
                    this.socketServerUrl,
                    this.onSocketMessage,
                    this.onSocketError,
                    this.onSocketReconnecting,
                    this.onSocketReconnected);
                return this.webSocket.connect();
            })
            .then(() => {
                const isoRequest = new Request('iso_codes.json');
                return fetch(isoRequest);
            })
            .then((response) => {
                return response.json();
            })
            .then((countryCodes) => {
                this.countryCodes = countryCodes as Object;

                return this.getWebSocket().request<number>("hello");
            })
            .then((clientId) => {
                this.clientId = clientId;
                return true;
            })
            .catch((error) => {
                this.setError("Failed to connect to server. " + error);
                return false;
            })
            .then((succeeded) => {
                if (!succeeded) return false;
                return this.getWebSocket().request<PiPedalVersion>("version").then(data => {
                    this.serverVersion = data;
                    return this.getWebSocket().request<any>("plugins");
                })
                    .then(data => {
                        this.ui_plugins.set(UiPlugin.deserialize_array(data));

                        return this.getWebSocket().request<PedalBoard>("currentPedalBoard");
                    })
                    .then(data => {
                        this.pedalBoard.set(new PedalBoard().deserialize(data));

                        return this.getWebSocket().request<any>("pluginClasses");
                    })
                    .then((data) => {

                        this.plugin_classes.set(new PluginClass().deserialize(data));
                        this.validatePlugins(this.plugin_classes.get());

                        return this.getWebSocket().request<PresetIndex>("getPresets");
                    })
                    .then((data) => {
                        this.presets.set(new PresetIndex().deserialize(data));
                        return this.getWebSocket().request<any>("getWifiConfigSettings");
                    })
                    .then(data => {
                        this.wifiConfigSettings.set(new WifiConfigSettings().deserialize(data));


                        return this.getWebSocket().request<any>("getJackServerSettings");
                    })
                    .then(data => {
                        this.jackServerSettings.set(new JackServerSettings().deserialize(data));

                        return this.getWebSocket().request<JackConfiguration>("getJackConfiguration");
                    })
                    .then((data) => {
                        // data.isValid = false;
                        // data.errorState = "Jack Audio server not running."

                        this.jackConfiguration.set(new JackConfiguration().deserialize(data));

                        return this.getWebSocket().request<any>("getJackSettings");
                    })
                    .then((data) => {
                        this.jackSettings.set(new JackChannelSelection().deserialize(data));

                        return this.getWebSocket().request<any>("getBankIndex");
                    })
                    .then((data) => {
                        this.banks.set(new BankIndex().deserialize(data));

                        return true;
                    })
                    .catch((error) => {
                        this.setError("Failed to fetch server state.\n\n" + error);
                        return false;
                    });

            })
            ;
    }

    // requestPlugins(): Promise<boolean> {
    //     const myRequest = new Request(this.varRequest('uiplugins.json'));
    //     return fetch(myRequest)
    //         .then(
    //             response => response.json()
    //         )
    //         .then(data => {
    //             let plugins = UiPlugin.deserialize_array(data);
    //             this.ui_plugins.set(plugins);
    //             return true;
    //         })
    //         .catch((error) => {
    //             this.setError("Can't contact server.\n\n" + error);
    //             return false;
    //         });

    // }
    requestCurrentPedalBoard(): Promise<void> {
        const myRequest = new Request(this.varRequest('current_pedalboard.json'));
        return fetch(myRequest)
            .then(
                (response) => {
                    return response.json();
                }
            )
            .then(data => {
                let pedalBoard = new PedalBoard().deserialize(data);
                pedalBoard.ensurePedalboardIds();
                this.pedalBoard.set(pedalBoard);
            });
    }

    onError(msg: string): void {
        this.errorMessage.set(msg);
        this.state.set(State.Error);

    }
    initialize(): void {
        this.setError("");
        this.setState(State.Loading);
        this.requestConfig()
            .then((succeeded) => {
                if (succeeded) {
                    this.state.set(State.Ready);
                }
            })
            .catch((error) => {
                this.setError("Failed to get server state. \n\n" + error);
            });
    }

    getControl(uiPlugin: UiPlugin, portSymbol: string): UiControl | null {
        for (let i = 0; i < uiPlugin.controls.length; ++i) {
            let control = uiPlugin.controls[i];
            if (control.symbol === portSymbol) {
                return control;
            }

        }
        return null;
    }
    getDefaultValues(uri: string): ControlValue[] {
        let uiPlugin = this.getUiPlugin(uri);
        if (uiPlugin === null) throw new PiPedalArgumentError("Pedal uri not found.");
        let result: ControlValue[] = [];

        let controls = uiPlugin.controls;
        for (let i = 0; i < controls.length; ++i) {
            let control = controls[i];

            let uiControl = this.getControl(uiPlugin, control.symbol);
            if (uiControl === null) {
                // this is default values, so a mis-match is in fact a problem.
                throw new PiPedalStateError("ui and pedealboard ports don't match.");
            }
            let cv = new ControlValue();
            cv.key = control.symbol;
            cv.value = control.default_value;


            result.push(cv);
        }
        return result;


    }



    handleOnLoadPluginPreset(instanceId: number, controlValues: ControlValue[]) {
        let pedalBoard = this.pedalBoard.get();
        if (pedalBoard === undefined) throw new PiPedalStateError("Pedalboard not ready.");
        let newPedalBoard = pedalBoard.clone();

        let item = newPedalBoard.getItem(instanceId);

        let changed = false;
        for (let i = 0; i < controlValues.length; ++i) {
            let controlValue = controlValues[i];
            changed = item.setControlValue(controlValue.key, controlValue.value) || changed;
        }
        if (changed) {
            this.pedalBoard.set(newPedalBoard);
        }
    }



    _setPedalBoardControlValue(instanceId: number, key: string, value: number, notifyServer: boolean): void {
        let pedalBoard = this.pedalBoard.get();
        if (pedalBoard === undefined) throw new PiPedalStateError("Pedalboard not ready.");
        let newPedalBoard = pedalBoard.clone();

        let item = newPedalBoard.getItem(instanceId);
        let changed = item.setControlValue(key, value);
        if (changed) {
            this.pedalBoard.set(newPedalBoard);
            if (notifyServer) {
                this._setServerControl("setControl", instanceId, key, value);
            }
        }

    }
    setPedalBoardControlValue(instanceId: number, key: string, value: number): void {
        this._setPedalBoardControlValue(instanceId, key, value, true);
    }
    setPedalBoardItemEnabled(instanceId: number, value: boolean): void {
        this._setPedalBoardItemEnabled(instanceId, value, true);
    }
    _setPedalBoardItemEnabled(instanceId: number, value: boolean, notifyServer: boolean): void {
        let pedalBoard = this.pedalBoard.get();
        if (pedalBoard === undefined) throw new PiPedalStateError("Pedalboard not ready.");
        let newPedalBoard = pedalBoard.clone();

        let item = newPedalBoard.getItem(instanceId);
        let changed = value !== item.isEnabled;
        if (changed) {
            item.isEnabled = value;
            this.pedalBoard.set(newPedalBoard);
            if (notifyServer) {
                let body: PedalBoardItemEnableBody = {
                    clientId: this.clientId,
                    instanceId: instanceId,
                    enabled: value
                }
                this.webSocket?.send("setPedalBoardItemEnable", body);

            }
        }

    }

    updateServerPedalBoard(): void {
        let body: PedalBoardChangedBody = {
            clientId: this.clientId,
            pedalBoard: this.pedalBoard.get()
        };
        this.webSocket?.send("setCurrentPedalBoard", body);

    }

    loadPedalBoardPlugin(itemId: number, selectedUri: string): number {
        let pedalBoard = this.pedalBoard.get();
        if (pedalBoard === undefined) throw new PiPedalArgumentError("Can't clone an undefined object.");
        let newPedalBoard = pedalBoard.clone();

        let plugin = this.getUiPlugin(selectedUri);
        if (plugin === null) {
            throw new PiPedalArgumentError("Plugin not found.");
        }

        let it = newPedalBoard.itemsGenerator();
        while (true) {
            let v = it.next();
            if (v.done) break;
            let item = v.value;
            if (item.instanceId === itemId) {
                item.instanceId = ++newPedalBoard.nextInstanceId;
                item.uri = selectedUri;
                item.pluginName = plugin.name;
                item.controlValues = this.getDefaultValues(item.uri);
                item.isEnabled = true;
                this.pedalBoard.set(newPedalBoard);
                this.updateServerPedalBoard()
                return item.instanceId;
            }
        }
        throw new PiPedalArgumentError("Pedalboard item not found.");

    }
    _setServerControl(message: string, instanceId: number, key: string, value: number) {
        let body: ControlChangedBody = {
            clientId: this.clientId,
            instanceId: instanceId,
            symbol: key,
            value: value
        };
        this.webSocket?.send(message, body);
    }
    previewPedalBoardValue(instanceId: number, key: string, value: number): void {
        // mouse is down. Don't update EVERYBODY, but we must change 
        // the control on the running audio plugin.
        this._setServerControl("previewControl", instanceId, key, value);
    }

    // returns the next selected instanceId, or null,if no item was deleted.
    deletePedalBoardPedal(instanceId: number): number | null {
        let pedalBoard = this.pedalBoard.get();
        let newPedalBoard = pedalBoard.clone();
        let result = newPedalBoard.deleteItem(instanceId);
        if (result != null) {
            this.pedalBoard.set(newPedalBoard);
            this.updateServerPedalBoard();
        }
        return result;


    }
    movePedalBoardItemBefore(fromInstanceId: number, toInstanceId: number): void {
        if (fromInstanceId === toInstanceId) return;
        let pedalBoard = this.pedalBoard.get();
        let newPedalBoard = pedalBoard.clone();
        let fromItem = newPedalBoard.getItem(fromInstanceId);
        if (fromItem === null) {
            throw new PiPedalArgumentError("fromInstanceId not found.");
        }

        newPedalBoard.deleteItem(fromInstanceId);

        newPedalBoard.addBefore(fromItem, toInstanceId);
        this.pedalBoard.set(newPedalBoard);
        this.updateServerPedalBoard();

    }
    movePedalBoardItemAfter(fromInstanceId: number, toInstanceId: number): void {
        if (fromInstanceId === toInstanceId) return;
        let pedalBoard = this.pedalBoard.get();
        let newPedalBoard = pedalBoard.clone();
        let fromItem = newPedalBoard.getItem(fromInstanceId);
        if (fromItem === null) {
            throw new PiPedalArgumentError("fromInstanceId not found.");
        }

        newPedalBoard.deleteItem(fromInstanceId);

        newPedalBoard.addAfter(fromItem, toInstanceId);

        this.pedalBoard.set(newPedalBoard);
        this.updateServerPedalBoard();
    }

    movePedalBoardItemToStart(instanceId: number): void {

        let pedalBoard = this.pedalBoard.get();
        let newPedalBoard = pedalBoard.clone();
        let fromItem = newPedalBoard.getItem(instanceId);
        if (fromItem === null) {
            throw new PiPedalArgumentError("fromInstanceId not found.");
        }

        newPedalBoard.deleteItem(instanceId);

        newPedalBoard.addToStart(fromItem);

        this.pedalBoard.set(newPedalBoard);
        this.updateServerPedalBoard();
    }
    movePedalBoardItemToEnd(instanceId: number): void {

        let pedalBoard = this.pedalBoard.get();
        let newPedalBoard = pedalBoard.clone();
        let fromItem = newPedalBoard.getItem(instanceId);
        if (fromItem === null) {
            throw new PiPedalArgumentError("fromInstanceId not found.");
        }

        newPedalBoard.deleteItem(instanceId);

        newPedalBoard.addToEnd(fromItem);

        this.pedalBoard.set(newPedalBoard);
        this.updateServerPedalBoard();


    }


    movePedalBoardItem(fromInstanceId: number, toInstanceId: number): void {
        if (fromInstanceId === toInstanceId) return;

        let pedalBoard = this.pedalBoard.get();
        let newPedalBoard = pedalBoard.clone();
        let fromItem = newPedalBoard.getItem(fromInstanceId);
        let toItem = newPedalBoard.getItem(toInstanceId);
        if (fromItem === null) {
            throw new PiPedalArgumentError("fromInstanceId not found.");
        }
        if (toItem === null) {
            throw new PiPedalArgumentError("toInstanceId not found.");
        }
        let emptyItem = newPedalBoard.createEmptyItem();
        newPedalBoard.replaceItem(fromInstanceId, emptyItem);
        newPedalBoard.replaceItem(toInstanceId, fromItem);
        this.pedalBoard.set(newPedalBoard);
        this.updateServerPedalBoard();

    }
    addPedalBoardItem(instanceId: number, append: boolean): number {
        let pedalBoard = this.pedalBoard.get();
        let newPedalBoard = pedalBoard.clone();
        let item = newPedalBoard.getItem(instanceId);
        if (item === null) {
            throw new PiPedalArgumentError("instanceId not found.");
        }
        let newItem = newPedalBoard.createEmptyItem();
        newPedalBoard.addItem(newItem, instanceId, append);
        this.pedalBoard.set(newPedalBoard);
        this.updateServerPedalBoard();
        return newItem.instanceId;
    }
    addPedalBoardSplitItem(instanceId: number, append: boolean): number {
        let pedalBoard = this.pedalBoard.get();
        let newPedalBoard = pedalBoard.clone();
        let item = newPedalBoard.getItem(instanceId);
        if (item === null) {
            throw new PiPedalArgumentError("instanceId not found.");
        }
        let newItem = newPedalBoard.createEmptySplit();
        newPedalBoard.addItem(newItem, instanceId, append);
        this.pedalBoard.set(newPedalBoard);
        this.updateServerPedalBoard();
        return newItem.instanceId;

    }
    setPedalBoardItemEmpty(instanceId: number): number {
        let pedalBoard = this.pedalBoard.get();
        let newPedalBoard = pedalBoard.clone();
        let item = newPedalBoard.getItem(instanceId);
        if (item === null) {
            throw new PiPedalArgumentError("instanceId not found.");
        }
        newPedalBoard.setItemEmpty(item);

        this.pedalBoard.set(newPedalBoard);
        this.updateServerPedalBoard();
        return item.instanceId;

    }


    saveCurrentPreset(): void {
        this.webSocket?.send("saveCurrentPreset", this.clientId);
    }

    saveCurrentPresetAs(newName: string, saveAfterInstanceId = -1): Promise<number> {
        // default behaviour is to save after the currently selected preset.
        if (saveAfterInstanceId === -1) {
            saveAfterInstanceId = this.presets.get().selectedInstanceId;
        }
        let request: any = {
            clientId: this.clientId,
            name: newName,
            saveAfterInstanceId: saveAfterInstanceId

        };

        return nullCast(this.webSocket)
            .request<number>("saveCurrentPresetAs", request)
            .then((data) => {
                return data;
            });
    }


    loadPreset(instanceId: number): void {
        this.webSocket?.send("loadPreset", instanceId);

    }
    updatePresets(presets: PresetIndex): Promise<void> {
        return nullCast(this.webSocket).request<void>("updatePresets", presets);
    }
    moveBank(from: number, to: number): Promise<void> {
        return nullCast(this.webSocket).request<void>("moveBank", { from: from, to: to });
    }


    deletePresetItem(instanceId: number): Promise<number> {
        return nullCast(this.webSocket).request<number>("deletePresetItem", instanceId);

    }
    deleteBankItem(instanceId: number): Promise<number> {
        return nullCast(this.webSocket).request<number>("deleteBankItem", instanceId);

    }

    renamePresetItem(instanceId: number, name: string): Promise<void> {
        let body: RenamePresetBody = {
            clientId: this.clientId,
            instanceId: instanceId,
            name: name
        };

        return nullCast(this.webSocket).request<void>("renamePresetItem", body);
    }

    copyPreset(fromId: number, toId: number = -1): Promise<number> {
        let body: any = {
            clientId: this.clientId,
            fromId: fromId,
            toId: toId
        };
        return nullCast(this.webSocket).request<number>("copyPreset", body);

    }
    duplicatePreset(instanceId: number): Promise<number> {
        return this.copyPreset(instanceId, -1);
    }

    showAlert(message: string): void {
        this.alertMessage.set(message);
    }
    setJackSettings(jackSettings: JackChannelSelection): void {
        this.webSocket?.send("setJackSettings", jackSettings);
    }


    monitorPortSubscriptions: MonitorPortHandleImpl[] = [];

    monitorPort(instanceId: number, key: string, updateRateSeconds: number, onUpdated: (value: number) => void): MonitorPortHandle {
        let result = new MonitorPortHandleImpl(instanceId, key, onUpdated);
        this.monitorPortSubscriptions.push(result);
        if (!this.webSocket) return result;


        this.webSocket.request<number>("monitorPort",
            {
                instanceId: instanceId,
                key: key,
                updateRate: updateRateSeconds
            })
            .then((handle) => {
                if (result.valid) {
                    result.subscriptionHandle = handle;
                } else {
                    try {
                        this.webSocket?.send("unmonitorPort", handle);
                    } catch (err) {

                    }
                }
            });
        return result;


    }
    unmonitorPort(handle: MonitorPortHandle): void {
        let t = handle as MonitorPortHandleImpl;

        for (let i = 0; i < this.monitorPortSubscriptions.length; ++i) {
            let item = this.monitorPortSubscriptions[i];
            if (item === t) {
                this.monitorPortSubscriptions.splice(i, 1);
                item.valid = false;
                if (item.subscriptionHandle) {
                    try {
                        this.webSocket?.send("unmonitorPort", item.subscriptionHandle);
                    } catch (err) {

                    }
                }
                break;
            }
        }
    }

    vuSubscriptions: (VuSubscriptionTarget | undefined)[] = [];


    addVuSubscription(instanceId: number, vuChangedHandler: VuChangedHandler): VuSubscriptionHandle {

        let result = new VuSubscriptionHandleImpl(instanceId, vuChangedHandler);

        if (!this.webSocket) return result; // racing to death. don't subscribe.

        let item = this.vuSubscriptions[instanceId];
        if (item) {
            item.subscribers.push(result);
        } else {
            let newTarget = new VuSubscriptionTarget();
            newTarget.subscribers.push(result);

            this.webSocket.request<number>("addVuSubscription", instanceId)
                .then((subscriptionHandle) => {
                    newTarget.serverSubscriptionHandle = subscriptionHandle;
                    if (newTarget.subscribers.length === 0) {
                        this.webSocket?.send("removeVuSubscription", subscriptionHandle);
                    } else {
                        newTarget.serverSubscriptionHandle = subscriptionHandle;
                    }
                });

            this.vuSubscriptions[instanceId] = newTarget;
        }
        return result;
    }

    removeVuSubscription(handle: VuSubscriptionHandle): void {
        let handleImpl = handle as VuSubscriptionHandleImpl;

        let item = this.vuSubscriptions[handleImpl.instanceId];
        if (item) {
            for (let i = 0; i < item.subscribers.length; ++i) {
                if (item.subscribers[i] === handleImpl) {
                    item.subscribers.splice(i, 1);
                    if (item.subscribers.length === 0) {
                        this.vuSubscriptions[handleImpl.instanceId] = undefined;
                        if (item.serverSubscriptionHandle) {
                            this.webSocket?.send("removeVuSubscription", item.serverSubscriptionHandle);
                            item.serverSubscriptionHandle = undefined;
                        }
                    }
                }
            }
        }

    }

    getLv2Parameter<Type = any>(instanceId: number, uri: string): Promise<Type> {
        let result = new Promise<Type>((resolve, reject) => {
            if (!this.webSocket) {
                reject("Socket closed.");
            } else {
                this.webSocket.request<Type>("getLv2Parameter", { instanceId: instanceId, uri: uri })
                    .then((data) => {
                        resolve(data);
                    })
                    .catch(error => reject(error));
            }
        });
        return result;
    }
    openBank(bankId: number): Promise<void> {
        let result = new Promise<void>((resolve, reject) => {
            if (this.webSocket) {
                this.webSocket.request<void>("openBank", bankId)
                    .then(() => {
                        resolve();

                    })
                    .catch((error) => {
                        reject(error);

                    });
            }
        });
        return result;
    }
    renameBank(bankId: number, newName: string): Promise<void> {
        let result = new Promise<void>((resolve, reject) => {
            if (!this.webSocket) {
                reject("No server connection.");
            } else {
                this.webSocket.request<void>("renameBank", { bankId: bankId, newName: newName })
                    .then(() => {
                        resolve();
                    })
                    .catch(error => reject(error));
            }
        });
        return result;
    }
    saveBankAs(bankId: number, newName: string): Promise<number> {
        let result = new Promise<number>((resolve, reject) => {
            if (!this.webSocket) {
                reject("No server connection.");
            } else {
                this.webSocket.request<number>("saveBankAs", { bankId: bankId, newName: newName })
                    .then((newInstanceId) => {
                        resolve(newInstanceId);
                    })
                    .catch(error => reject(error));
            }
        });
        return result;
    }

    getJackStatus(): Promise<JackHostStatus> {
        let result = new Promise<JackHostStatus>((resolve, reject) => {
            if (!this.webSocket) {
                reject("No connection to server.");
            } else {
                this.webSocket.request<any>("getJackStatus")
                    .then((data) => {
                        resolve(new JackHostStatus().deserialize(data));
                    })
                    .catch(error => reject(error));
            }
        });
        return result;
    }

    presetCache: { [uri: string]: PluginPreset[]; } = {};


    getPluginPresets(uri: string): Promise<PluginPreset[]> {
        return new Promise<PluginPreset[]>((resolve, reject) => {
            if (this.presetCache[uri] !== undefined) {
                resolve(this.presetCache[uri]);
            } else {
                this.webSocket!.request<any>("getPluginPresets", uri)
                    .then((result) => {
                        this.presetCache[uri] = PluginPreset.deserialize_array(result);
                        resolve(result);
                    })
                    .catch((error) => {
                        reject(error);
                    })
            }
        });
    }

    loadPluginPreset(instanceId: number, presetName: string): void {
        this.webSocket?.send("loadPluginPreset", { instanceId: instanceId, presetName: presetName });
    }

    shutdown(): Promise<void> {
        return this.webSocket!.request<void>("shutdown");
    }
    restart(): Promise<void> {
        return this.webSocket!.request<void>("restart");

    }
    getJackServerSettings(): Promise<JackServerSettings> {
        return this.webSocket!.request<any>("getJackServerSettings")
            .then((data) => {
                return new JackServerSettings().deserialize(data);
            });
    }
    setJackServerSettings(jackServerSettings: JackServerSettings): void {
        this.webSocket?.request<void>("setJackServerSettings", jackServerSettings)
            .catch((error) => {
                this.showAlert(error);
            });
    }
    setMidiBinding(instanceId: number, midiBinding: MidiBinding): void {
        let pedalBoard = this.pedalBoard.get();
        if (!pedalBoard) {
            throw new PiPedalStateError("Pedalboard not loaded.");
        }
        let newPedalBoard = pedalBoard.clone();
        if (newPedalBoard.setMidiBinding(instanceId, midiBinding)) {
            this.pedalBoard.set(newPedalBoard);
            // notify the server.
            // TODO: a more efficient notification.
            this.updateServerPedalBoard()

        }
    }
    midiListeners: MidiEventListener[] = [];

    nextListenHandle = 1;
    listenForMidiEvent(listenForControlsOnly: boolean, onComplete: (isNote: boolean, noteOrControl: number) => void): ListenHandle {
        let handle = this.nextListenHandle++;

        this.midiListeners.push(new MidiEventListener(handle, onComplete));

        this.webSocket?.send("listenForMidiEvent", { listenForControlsOnly: listenForControlsOnly, handle: handle });
        return {
            _handle: handle
        };

    }

    handleNotifyMidiListener(clientHandle: number, isNote: boolean, noteOrControl: number) {
        for (let i = 0; i < this.midiListeners.length; ++i) {
            let listener = this.midiListeners[i];
            if (listener.handle === clientHandle) {
                listener.callback(isNote, noteOrControl);

                this.midiListeners.splice(i, 1);
            }
        }
    }
    cancelListenForMidiEvent(listenHandle: ListenHandle): void {
        for (let i = 0; i < this.midiListeners.length; ++i) {
            if (this.midiListeners[i].handle === listenHandle._handle) {
                this.midiListeners.splice(i, 1);
            }
        }
        this.webSocket?.send("cancelListenForMidiEvent", listenHandle._handle);
    }

    download(targetType: string, instanceId: number): void {
        if (instanceId === -1) return;
        let url = this.varServerUrl + targetType + "?id=" + instanceId;
        window.open(url, "_blank");
    }

    uploadPreset(file: File, uploadAfter: number): Promise<number> {
        let result = new Promise<number>((resolve, reject) => {
            try {
                if (file.size > this.maxUploadSize) {
                    reject("File is too large.");
                }
                let url = this.varServerUrl + "uploadPreset";
                if (uploadAfter && uploadAfter !== -1) {
                    url += "?uploadAfter=" + uploadAfter;
                }
                fetch(
                    url,
                    {
                        method: "POST",
                        body: file,
                        headers: {
                            'Content-Type': 'application/json',
                        },
                    }
                )
                    .then((response: Response) => {
                        if (!response.ok) {
                            reject("Upload failed. " + response.statusText);
                            return;
                        } else {
                            return response.json(); // read the empty body to keep the connection alive.
                        }
                    })
                    .then((json) => {
                        resolve(json as number);
                    })
                    .catch((error) => {
                        reject("Upload failed. " + error);
                    })
                    ;
            } catch (error) {
                reject("Upload failed. " + error);
            }
        });
        return result;
    }
    setWifiConfigSettings(wifiConfigSettings: WifiConfigSettings): Promise<void> {
        let result = new Promise<void>((resolve, reject) => {
            let oldSettings = this.wifiConfigSettings.get();
            wifiConfigSettings = wifiConfigSettings.clone();

            if ((!oldSettings.enable) && (!wifiConfigSettings.enable)) {
                // no effective change.
                resolve();
                return;
            }
            if (!wifiConfigSettings.enable) {
                wifiConfigSettings.hasPassword = false;
                wifiConfigSettings.hotspotName = oldSettings.hotspotName;
            } else {
                if (wifiConfigSettings.countryCode === oldSettings.countryCode
                    && wifiConfigSettings.channel === oldSettings.channel
                    && wifiConfigSettings.hotspotName === oldSettings.hotspotName) {
                    if (!wifiConfigSettings.hasPassword) {
                        // no effective change.
                        resolve();
                        return;
                    }
                }
            }
            // save a  version for the server (potentially carrying a password)
            let serverConfigSettings = wifiConfigSettings.clone();
            wifiConfigSettings.password = "";
            this.wifiConfigSettings.set(wifiConfigSettings);



            // notify the server.
            let ws = this.webSocket;
            if (!ws) {
                reject("Not connected.");
                return;
            }
            ws.request<void>(
                "setWifiConfigSettings",
                serverConfigSettings
            )
                .then(() => {
                    resolve();
                })
                .catch((err) => {
                    reject(err);
                });

        });
        return result;
    }

    getWifiChannels(countryIso3661: string): Promise<WifiChannel[]> {
        let result = new Promise<WifiChannel[]>((resolve, reject) => {
            if (!this.webSocket) {
                reject("Connection closed.");
                return;
            }
            this.webSocket.request<WifiChannel[]>("getWifiChannels", countryIso3661)
                .then((data) => {
                    resolve(WifiChannel.deserialize_array(data));
                })
                .catch((err) => reject(err));
        });
        return result;
    }


};

let instance: PiPedalModel | undefined = undefined;



export class PiPedalModelFactory {
    static getInstance(): PiPedalModel {
        if (instance === undefined) {
            let impl: PiPedalModelImpl = new PiPedalModelImpl();
            instance = impl;

            impl.initialize();
        }
        return instance;

    }
};



