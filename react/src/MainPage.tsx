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

import { SyntheticEvent } from 'react';
import { Theme } from '@mui/material/styles';
import { WithStyles } from '@mui/styles';
import createStyles from '@mui/styles/createStyles';
import withStyles from '@mui/styles/withStyles';
import { PiPedalModel, PiPedalModelFactory } from './PiPedalModel';
import {
    Pedalboard, PedalboardItem, PedalboardSplitItem, SplitType
} from './Pedalboard';
import Button from '@mui/material/Button';
import InputIcon from '@mui/icons-material/Input';
import LoadPluginDialog from './LoadPluginDialog';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';

import PedalboardView from './PedalboardView';
import { PiPedalStateError } from './PiPedalError';
import IconButton from '@mui/material/IconButton';
import AddIcon from '@mui/icons-material/Add';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Fade from '@mui/material/Fade';
import Divider from '@mui/material/Divider';
import ResizeResponsiveComponent from './ResizeResponsiveComponent';
import PluginInfoDialog from './PluginInfoDialog';
import { GetControlView } from './ControlViewFactory';
import MidiBindingsDialog from './MidiBindingsDialog';
import PluginPresetSelector from './PluginPresetSelector';
import {ReactComponent as OldDeleteIcon} from "./svg/old_delete_outline_24dp.svg";
import {ReactComponent as MidiIcon} from "./svg/ic_midi.svg";
import {isDarkMode} from './DarkMode';

const SPLIT_CONTROLBAR_THRESHHOLD = 650;

const HORIZONTAL_CONTROL_SCROLL_HEIGHT_BREAK = 500;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const HORIZONTAL_LAYOUT_MQ = "@media (max-height: " + HORIZONTAL_CONTROL_SCROLL_HEIGHT_BREAK + "px)";

const styles = ({ palette }: Theme) => createStyles({
    frame: {
        position: "absolute", display: "flex", flexDirection: "column", flexWrap: "nowrap",
        justifyContent: "flex-start", left: "0px", top: "0px", bottom: "0px", right: "0px", overflow: "hidden"
    },
    pedalboardScroll: {
        position: "relative", width: "100%",
        flex: "0 0 auto", overflow: "auto", maxHeight: 220
    },
    pedalboardScrollSmall: {
        position: "relative", width: "100%",
        flex: "1 1 1px", overflow: "auto"
    },
    separator: {
        width: "100%", height: "1px", background: "#888", opacity: "0.5",
        flex: "0 0 1px"
    },

    controlToolBar: {
        flex: "0 0 auto", width: "100%", height: 48
    },
    splitControlBar: {
        flex: "0 0 64px", width: "100%", paddingLeft: 24, paddingRight: 16, paddingBottom: 16
    },
    controlContent: {
        flex: "1 1 auto", width: "100%", overflowY: "auto", minHeight: 240
    },
    controlContentSmall: {
        flex: "0 0 162px", width: "100%", height: 162, overflowY: "hidden",
    },
    title: { fontSize: "1.1em", fontWeight: 700, marginRight: 8, textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: 0.75 },
    author: { fontWeight: 500, marginRight: 8, textOverflow: "ellipsis", whiteSpace: "nowrap",opacity: 0.75 }
});



interface MainProps extends WithStyles<typeof styles> {
    hasTinyToolBar: boolean;
    theme: Theme;
}

interface MainState {
    selectedPedal: number;
    loadDialogOpen: boolean;
    pedalboard: Pedalboard;
    addMenuAnchorEl: HTMLElement | null;
    splitControlBar: boolean;
    horizontalScrollLayout: boolean;
    showMidiBindingsDialog: boolean;
    screenHeight: number;

}


export const MainPage =
    withStyles(styles, { withTheme: true })(
        class extends ResizeResponsiveComponent<MainProps, MainState>
        {
            model: PiPedalModel;

            constructor(props: MainProps) {
                super(props);
                this.model = PiPedalModelFactory.getInstance();
                let pedalboard = this.model.pedalboard.get();
                let selectedPedal = pedalboard.getFirstSelectableItem();

                this.state = {
                    selectedPedal: selectedPedal,
                    loadDialogOpen: false,
                    pedalboard: pedalboard,
                    addMenuAnchorEl: null,
                    splitControlBar: this.windowSize.width < SPLIT_CONTROLBAR_THRESHHOLD,
                    horizontalScrollLayout: this.windowSize.height < HORIZONTAL_CONTROL_SCROLL_HEIGHT_BREAK,
                    showMidiBindingsDialog: false,
                    screenHeight: this.windowSize.height

                };
                this.onSelectionChanged = this.onSelectionChanged.bind(this);
                this.onPedalDoubleClick = this.onPedalDoubleClick.bind(this);
                this.onLoadClick = this.onLoadClick.bind(this);
                this.onLoadOk = this.onLoadOk.bind(this);
                this.onLoadCancel = this.onLoadCancel.bind(this);
                this.onPedalboardChanged = this.onPedalboardChanged.bind(this);
                this.handleEnableCurrentItemChanged = this.handleEnableCurrentItemChanged.bind(this);
            }

            onInsertPedal(instanceId: number) {
                this.setAddMenuAnchorEl(null);
                let newId = this.model.addPedalboardItem(instanceId, false);
                this.setSelection(newId);
            }
            onAppendPedal(instanceId: number) {
                this.setAddMenuAnchorEl(null);
                let newId = this.model.addPedalboardItem(instanceId, true);

                this.setSelection(newId);

            }
            onInsertSplit(instanceId: number) {
                this.setAddMenuAnchorEl(null);
                let newId = this.model.addPedalboardSplitItem(instanceId, false);
                this.setSelection(newId);

            }
            onAppendSplit(instanceId: number) {
                this.setAddMenuAnchorEl(null);
                let newId = this.model.addPedalboardSplitItem(instanceId, true);
                this.setSelection(newId);

            }
            setAddMenuAnchorEl(value: HTMLElement | null) {
                this.setState({ addMenuAnchorEl: value });
            }
            onAddClick(e: SyntheticEvent) {
                this.setAddMenuAnchorEl(e.currentTarget as HTMLElement);
            }

            handleMidiBindingsDialogClose() {
                this.setState({ showMidiBindingsDialog: false })
            }
            handleAddClose(): void {
                this.setAddMenuAnchorEl(null);
            }

            handleMidiConfiguration(instanceId: number): void {
                this.setState({ showMidiBindingsDialog: true });
            }
            handleEnableCurrentItemChanged(event: any): void {
                let newValue = event.target.checked;
                let item = this.getSelectedPedalboardItem();
                if (item != null) {
                    this.model.setPedalboardItemEnabled(item.getInstanceId(), newValue);

                }
            }
            handleSelectPluginPreset(instanceId: number, presetInstanceId: number) {
                this.model.loadPluginPreset(instanceId, presetInstanceId);
            }
            onPedalboardChanged(value: Pedalboard) {
                let selectedItem = -1;
                if (this.state.selectedPedal === Pedalboard.START_CONTROL || this.state.selectedPedal === Pedalboard.END_CONTROL) {
                    selectedItem = this.state.selectedPedal;
                } else if (value.hasItem(this.state.selectedPedal)) {
                    selectedItem = this.state.selectedPedal;
                } else {
                    selectedItem = value.getFirstSelectableItem();
                }
                this.setState({
                    pedalboard: value,
                    selectedPedal: selectedItem
                });
            }
            onDeletePedal(instanceId: number): void {
                let result = this.model.deletePedalboardPedal(instanceId);
                if (result != null) {
                    this.setState({ selectedPedal: result });
                }
            }

            componentDidMount() {
                super.componentDidMount();
                this.model.pedalboard.addOnChangedHandler(this.onPedalboardChanged);
            }
            componentWillUnmount() {
                this.model.pedalboard.removeOnChangedHandler(this.onPedalboardChanged);
                super.componentWillUnmount();
            }
            updateResponsive() {
                this.setState({
                    splitControlBar: this.windowSize.width < SPLIT_CONTROLBAR_THRESHHOLD,
                    horizontalScrollLayout: this.windowSize.height < HORIZONTAL_CONTROL_SCROLL_HEIGHT_BREAK,
                    screenHeight: this.windowSize.height
                });
            }
            onWindowSizeChanged(width: number, height: number): void {
                super.onWindowSizeChanged(width, height);
                this.updateResponsive();
            }


            setSelection(selectedId_: number): void {
                this.setState({ selectedPedal: selectedId_ });
            }

            onSelectionChanged(selectedId: number): void {
                this.setSelection(selectedId);
            }
            onPedalDoubleClick(selectedId: number): void {
                this.setSelection(selectedId);
                let item = this.getPedalboardItem(selectedId);
                if (item != null) {
                    if (item.isSplit()) {
                        let split = item as PedalboardSplitItem;
                        if (split.getSplitType() === SplitType.Ab) {
                            let cv = split.getToggleAbControlValue();
                            if (split.instanceId === undefined) throw new PiPedalStateError("Split without valid id.");
                            this.model.setPedalboardControl(split.instanceId, cv.key, cv.value);
                        }
                    } else {
                        this.setState({ loadDialogOpen: true });
                    }
                }
            }
            onLoadCancel(): void {
                this.setState({ loadDialogOpen: false });
            }
            onLoadOk(selectedUri: string): void {
                this.setState({ loadDialogOpen: false });
                let itemId = this.state.selectedPedal;
                let newSelectedItem = this.model.loadPedalboardPlugin(itemId, selectedUri);
                this.setState({ selectedPedal: newSelectedItem });
            }

            onLoadClick(e: SyntheticEvent) {
                this.setState({ loadDialogOpen: true });
            }

            getPedalboardItem(selectedId?: number): PedalboardItem | null {
                if (selectedId === undefined) return null;

                let pedalboard = this.model.pedalboard.get();
                if (!pedalboard) return null;

                if (selectedId === Pedalboard.START_CONTROL) // synthetic input volume item.
                {
                    return pedalboard.makeStartItem();
                } else if (selectedId === Pedalboard.END_CONTROL) // synthetic output volume.
                {
                    return pedalboard.makeEndItem();
                }

                let it = pedalboard.itemsGenerator();
                if (!selectedId) return null;
                while (true) {
                    let v = it.next();
                    if (v.done) break;
                    let item = v.value;
                    if (item.instanceId === selectedId) {
                        return item;
                    }

                }
                return null;

            }

            onPedalboardPropertyChanged(instanceId: number, key: string, value: number) {
                this.model.setPedalboardControl(instanceId, key, value);
            }
            getSelectedPedalboardItem(): PedalboardItem | null {
                return this.getPedalboardItem(this.state.selectedPedal);
            }
            getSelectedUri(): string {
                let pedalboardItem = this.getSelectedPedalboardItem();
                if (pedalboardItem === null) return "";
                return pedalboardItem.uri;
            }
            titleBar(pedalboardItem: PedalboardItem | null): React.ReactNode {
                let title = "";
                let author = "";
                let pluginUri = "";
                let presetsUri = "";
                let missing = false;
                if (pedalboardItem) {
                    if (pedalboardItem.isEmpty()) {
                        title = "";
                    } else if (pedalboardItem.isSplit()) {
                        title = "Split";
                    } else if (pedalboardItem.isSyntheticItem()) {
                        title = pedalboardItem.pluginName ?? "#error";
                        author = "";
                        presetsUri = "";
                        pluginUri = "";
                    }
                    else {
                        let uiPlugin = this.model.getUiPlugin(pedalboardItem.uri);
                        if (!uiPlugin) {
                            missing = true;
                            title = pedalboardItem?.pluginName ?? "Missing plugin";
                        } else {
                            title = uiPlugin.name;
                            author = uiPlugin.author_name;
                            presetsUri = uiPlugin.uri;
                            if (uiPlugin.description.length > 20) {
                                pluginUri = uiPlugin.uri;
                            }
                        }
                    }
                }
                let classes = this.props.classes;
                if (missing) {
                    return (
                        <div style={{
                            flex: "1 0 auto", overflow: "hidden", marginRight: 8, minWidth: 0,
                            display: "flex", flexDirection: "row", height: 48, flexWrap: "nowrap",
                            alignItems: "center"
                        }}>
                            <div style={{ flex: "0 1 auto",minWidth: 0 }}>
                                <span style={{ color: "#800000" }}>
                                    <span className={classes.title}>{title}</span>
                                </span>
                            </div>
                        </div>
                    );

                } else {
                    return (
                        <div style={{
                            flex: "1 1 auto", minWidth: 0,overflow: "hidden", marginRight: 8,
                            display: "flex", flexDirection: "row", height: 48, flexWrap: "nowrap",
                            alignItems: "center"
                        }}>
                            <div style={{ flex: "0 1 auto", minWidth: 0,overflow: "hidden",textOverflow: "ellipsis" }}>
                                <span className={classes.title}>{title}</span>
                                <span className={classes.author}>{author}</span>
                            </div>
                            <div style={{ flex: "0 0 auto", verticalAlign: "center" }}>
                                <PluginInfoDialog plugin_uri={pluginUri} />
                            </div>
                            <div style={{ flex: "0 0 auto" }}>
                                <PluginPresetSelector pluginUri={presetsUri} instanceId={pedalboardItem?.instanceId ?? 0}
                                />
                            </div>
                        </div>
                    );
                }
            }


            render() {
                let classes = this.props.classes;
                let pedalboard = this.model.pedalboard.get();
                let pedalboardItem = this.getSelectedPedalboardItem();
                let uiPlugin = null;
                let bypassVisible = false;
                let bypassChecked = false;
                let canDelete = false;
                let canInsert = false;
                let canAppend = false;
                let canLoad = true;
                let instanceId = -1;
                let missing = false;
                let pluginUri = "#error";

                if (pedalboardItem) {
                    canDelete = pedalboard.canDeleteItem(pedalboardItem.instanceId);
                    instanceId = pedalboardItem.instanceId;
                    if (pedalboardItem.isEmpty()) {
                        canInsert = true;
                        canAppend = true;

                    } else if (pedalboardItem.isStart()) {
                        canAppend = true;
                        canDelete = false;
                        canLoad = false;
                    } else if (pedalboardItem.isEnd()) {
                        canInsert = true;
                        canDelete = false;
                        canLoad = false;
                    } else if (pedalboardItem.isSplit()) {
                        canInsert = true;
                        canAppend = true;
                        canLoad = false;
                    } else {
                        pluginUri = pedalboardItem.uri;
                        uiPlugin = this.model.getUiPlugin(pluginUri);
                        canInsert = true;
                        canAppend = true;
                        if (uiPlugin) {
                            bypassVisible = true;
                            bypassChecked = pedalboardItem.isEnabled;
                        } else {
                            missing = true;
                        }
                    }
                }
                let horizontalScrollLayout = this.state.horizontalScrollLayout;

                return (
                    <div className={classes.frame}>
                        <div id="pedalboardScroll" className={horizontalScrollLayout ? classes.pedalboardScrollSmall : classes.pedalboardScroll}
                            style={{ maxHeight: horizontalScrollLayout ? undefined : this.state.screenHeight / 2 }}>
                            <PedalboardView key={pluginUri} selectedId={this.state.selectedPedal}
                                onSelectionChanged={this.onSelectionChanged}
                                onDoubleClick={this.onPedalDoubleClick}
                                hasTinyToolBar={this.props.hasTinyToolBar}
                            />
                        </div>
                        <div className={classes.separator} />
                        <div className={classes.controlToolBar}>
                            <div style={{
                                display: "flex", flexFlow: "row nowrap", alignItems: "center", justifyContent: "center", minWidth: 0,
                                width: "100%", height: 48, paddingLeft: 16, paddingRight: 16
                            }} >
                                <div style={{ flex: "0 0 auto", width: 80 }} >
                                    <div style={{ display: bypassVisible ? "block" : "none", width: 80 }} >
                                        <Switch color="secondary" checked={bypassChecked} onChange={this.handleEnableCurrentItemChanged} />
                                    </div>
                                </div>
                                {
                                    (!this.state.splitControlBar) && this.titleBar(pedalboardItem)
                                }
                                <div style={{ flex: "1 1 1px" }}>

                                </div>
                                <div style={{ flex: "0 0 auto", display: (canInsert || canAppend) ? "block" : "none", paddingRight: 8 }}>
                                    <IconButton onClick={(e) => { this.onAddClick(e) }} size="large">
                                        <AddIcon style={{height: 24, width: 24,fill: this.props.theme.palette.text.primary, opacity: 0.6}} />
                                    </IconButton>
                                    <Menu
                                        id="add-menu"
                                        anchorEl={this.state.addMenuAnchorEl}
                                        keepMounted
                                        open={Boolean(this.state.addMenuAnchorEl)}
                                        onClose={() => this.handleAddClose()}
                                        TransitionComponent={Fade}
                                    >
                                        {canInsert && (<MenuItem onClick={() => this.onInsertPedal(instanceId)}>Insert pedal</MenuItem>)}
                                        {canAppend && (<MenuItem onClick={() => this.onAppendPedal(instanceId)}>Append pedal</MenuItem>)}
                                        <Divider />
                                        {canInsert && (<MenuItem onClick={() => this.onInsertSplit(instanceId)}>Insert split</MenuItem>)}
                                        {canAppend && (<MenuItem onClick={() => this.onAppendSplit(instanceId)}>Append split</MenuItem>)}
                                    </Menu>
                                </div>
                                <div style={{ flex: "0 0 auto", display: canDelete ? "block" : "none", paddingRight: 8 }}>
                                    <IconButton
                                        onClick={() => { this.onDeletePedal(pedalboardItem?.instanceId ?? -1) }}
                                        size="large">
                                        <OldDeleteIcon style={{height: 24, width: 24,fill: this.props.theme.palette.text.primary, opacity: 0.6}} />
                                    </IconButton>
                                </div>
                                <div style={{ flex: "0 0 auto" }}>
                                    <Button
                                        variant="contained"
                                        color="primary"
                                        size="small"
                                        onClick={this.onLoadClick}
                                        disabled={this.state.selectedPedal === -1 || (!canLoad) || (this.getSelectedPedalboardItem()?.isSplit() ?? true)}
                                        startIcon={<InputIcon />}
                                        style={{ textTransform: "none", 
                                            background: (isDarkMode() ? "#6750A4": undefined) }}
                                    >
                                        Load
                                    </Button>
                                </div>
                                <div style={{ flex: "0 0 auto" }}>
                                    <IconButton
                                        onClick={(e) => { this.handleMidiConfiguration(instanceId); }}
                                        size="large">
                                        <MidiIcon style={{height: 24, width: 24,fill: this.props.theme.palette.text.primary, opacity: 0.6}} />
                                    </IconButton>

                                </div>
                            </div>
                        </div>
                        {
                            this.state.splitControlBar && (
                                <div className={classes.splitControlBar}>
                                    {
                                        this.titleBar(pedalboardItem)
                                    }
                                </div>
                            )
                        }
                        <div className={horizontalScrollLayout ? classes.controlContentSmall : classes.controlContent}>
                            {
                                missing ? (
                                    <div style={{ marginLeft: 100, marginTop: 20 }}>
                                        <Typography variant="body1" paragraph={true}>Error: Plugin is not installed.</Typography>
                                        <Typography noWrap variant="body2" paragraph={true}>{pluginUri}</Typography>
                                    </div>

                                ) :
                                    (
                                        GetControlView(pedalboardItem)
                                    )
                            }
                        </div>
                        <MidiBindingsDialog open={this.state.showMidiBindingsDialog}
                            onClose={() => this.setState({ showMidiBindingsDialog: false })}
                        />
                        {
                            (this.state.loadDialogOpen) && (
                                <LoadPluginDialog open={this.state.loadDialogOpen} uri={this.getSelectedUri()}
                                    onOk={this.onLoadOk} onCancel={this.onLoadCancel}
                                />

                            )
                        }
                    </div>
                );
            }
        }
    );

export default MainPage