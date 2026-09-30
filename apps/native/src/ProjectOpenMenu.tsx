import {useRef, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {hostClient, useHostClient} from './HostClient';
import {Icon, type IconName} from './Icon';
import {color, useThemeStyles} from './Theme';
import type {Palette} from './themePalette';
import {tid} from './testId';
import {setProjectExpanded} from './railExpansion';

function Item({label, icon, disabled = false, testId, onPress}: {label: string; icon: IconName; disabled?: boolean; testId?: string; onPress?: () => void}) {
  const s = useStyles();
  const [hovered, setHovered] = useState(false);
  return <Pressable {...(testId ? tid(testId) : {})} accessibilityRole="menuitem" disabled={disabled} onPress={onPress}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={[s.item, hovered && !disabled && s.hovered]}>
    <Icon name={icon} color={disabled ? color.hint : color.muted} size={15} />
    <Text numberOfLines={1} style={[s.itemText, disabled && s.disabled]}>{label}</Text>
  </Pressable>;
}

export function ProjectOpenMenu({open, onClose, anchor}: {open: boolean; onClose: () => void; anchor: {x: number; y: number}}) {
  const s = useStyles();
  const {recentProjects} = useHostClient();
  const [pathEntry, setPathEntry] = useState<string | null>(null);
  const [pathDraft, setPathDraft] = useState('');
  const [initPath, setInitPath] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const latest = useRef(0);
  const start = () => ++latest.current;
  const current = (id: number) => latest.current === id;

  const openPath = async (rawPath: string, id: number) => {
    const path = rawPath.trim();
    if (!path || !current(id)) return;
    try {
      const project = await hostClient.openProject(path, () => current(id));
      if (current(id)) setProjectExpanded(project.id, true);
      if (current(id)) setPathEntry(null);
    } catch (error) {
      if (!current(id)) return;
      const status = await hostClient.inspectProject(path).catch(() => null);
      if (!current(id)) return;
      setPathEntry(null);
      if (status?.kind === 'initable') setInitPath(path);
      else if (status?.kind === 'missing') setNotice(`This folder no longer exists:\n${path}`);
      else if (status?.kind === 'notDirectory') setNotice(`This isn't a folder:\n${path}`);
      else setNotice(String(error));
    }
  };

  const pickAndOpen = async () => {
    const id = start();
    onClose();
    try {
      const {path} = await hostClient.pickProjectDirectory();
      if (path && current(id)) await openPath(path, id);
    } catch (error) {
      if (current(id)) {setPathDraft(''); setPathEntry(`Couldn't open the folder picker on the host. ${String(error)}`);}
    }
  };

  const enterHostPath = () => {
    start();
    onClose();
    setPathDraft('');
    setPathEntry('');
  };

  const openRecent = (path: string) => {
    const id = start();
    onClose();
    return openPath(path, id);
  };

  const initialize = async () => {
    const path = initPath;
    if (!path) return;
    const id = start();
    setInitPath(null);
    try {
      const project = await hostClient.initProject(path, () => current(id));
      if (current(id)) setProjectExpanded(project.id, true);
    }
    catch (error) {if (current(id)) setNotice(`Couldn't initialise a git repository in ${path}.\n${String(error)}`);}
  };

  return <>
    {open ? <View style={s.menuLayer}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={[s.menu, {left: Math.max(8, anchor.x), top: anchor.y}]}>
        <Item label="Open project" icon="folderOpen" testId="menu-open-project" onPress={pickAndOpen} />
        <Item label="Enter host path…" icon="pencil" testId="menu-enter-host-path" onPress={enterHostPath} />
        <Item label="Open GitHub project" icon="globe" disabled />
        {recentProjects.length ? <>
          <View style={s.separator} />
          <Text style={s.groupLabel}>RECENTS</Text>
          <ScrollView style={s.recents}>
            {recentProjects.map(project => <Item key={project.id} testId="recent-project" label={project.path} icon="folder"
              onPress={() => openRecent(project.path)} />)}
          </ScrollView>
        </> : null}
      </View>
    </View> : null}
    {pathEntry !== null ? <View style={s.dialogLayer}>
      <Pressable style={s.backdrop} onPress={() => setPathEntry(null)} />
      <View {...tid('open-project-path-dialog')} style={s.dialog}>
        <Text style={s.title}>Open project from host path</Text>
        <Text style={s.description}>Enter a folder path on the computer running ThinkRail. Absolute paths and ~/… are accepted.</Text>
        {pathEntry ? <View {...tid('open-project-picker-error')}><Text style={s.error}>{pathEntry}</Text></View> : null}
        <TextInput {...tid('open-project-path-input')} autoFocus value={pathDraft} onChangeText={setPathDraft} onSubmitEditing={() => openPath(pathDraft, start())}
          accessibilityLabel="Host project path" placeholder="/path/to/repository" placeholderTextColor={color.hint} style={s.pathInput} />
        <View style={s.actions}>
          <Item label="Cancel" icon="close" onPress={() => setPathEntry(null)} />
          <Item label="Open" icon="folderOpen" testId="open-project-path-submit" onPress={() => openPath(pathDraft, start())} />
        </View>
      </View>
    </View> : null}
    {initPath ? <View style={s.dialogLayer}>
      <Pressable style={s.backdrop} onPress={() => setInitPath(null)} />
      <View style={s.dialog}>
        <Text style={s.title}>Initialize a git repository?</Text>
        <Text style={s.description}>{initPath} isn't a git repository. ThinkRail works on git worktrees, so it needs one. Initialize a repo here and commit the folder's current contents?</Text>
        <View style={s.actions}>
          <Item label="Cancel" icon="close" onPress={() => setInitPath(null)} />
          <Item label="Initialize & open" icon="folderOpen" testId="confirm-init-repo" onPress={initialize} />
        </View>
      </View>
    </View> : null}
    {notice ? <View style={s.dialogLayer}>
      <Pressable style={s.backdrop} onPress={() => setNotice('')} />
      <View {...tid('open-error-dialog')} style={s.dialog}>
        <Text style={s.title}>Couldn't open project</Text>
        <Text style={s.description}>{notice}</Text>
        <View style={s.actions}><Item label="OK" icon="check" onPress={() => setNotice('')} /></View>
      </View>
    </View> : null}
  </>;
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  menuLayer: {...StyleSheet.absoluteFillObject, zIndex: 16},
  menu: {position: 'absolute', width: 260, padding: 4, borderWidth: 1, borderRadius: 6, borderColor: palette.borderStrong, backgroundColor: palette.elevated},
  item: {minHeight: 30, paddingHorizontal: 8, flexDirection: 'row', gap: 9, alignItems: 'center', borderRadius: 4},
  hovered: {backgroundColor: palette.hover},
  itemText: {flex: 1, fontFamily: 'Geist Native Text', fontSize: 13, color: palette.text},
  disabled: {color: palette.hint},
  separator: {height: 1, marginVertical: 4, backgroundColor: palette.border},
  groupLabel: {paddingHorizontal: 8, paddingVertical: 4, fontFamily: 'Geist Native Text', fontSize: 11, color: palette.muted},
  recents: {maxHeight: 260},
  dialogLayer: {...StyleSheet.absoluteFillObject, zIndex: 25, alignItems: 'center', justifyContent: 'center'},
  backdrop: {...StyleSheet.absoluteFillObject, backgroundColor: '#000000a8'},
  dialog: {width: 440, maxWidth: '88%', padding: 18, gap: 12, borderWidth: 1, borderRadius: 8, borderColor: palette.borderStrong, backgroundColor: palette.surface},
  title: {fontFamily: 'Geist SemiBold', fontSize: 17, color: palette.text},
  description: {fontFamily: 'Geist Native Text', fontSize: 13, lineHeight: 19, color: palette.muted},
  error: {fontFamily: 'Geist Native Text', fontSize: 12, lineHeight: 18, color: palette.red},
  pathInput: {height: 34, paddingHorizontal: 9, borderWidth: 1, borderRadius: 4, borderColor: palette.borderStrong, color: palette.text, fontFamily: 'Geist Native Text', fontSize: 13},
  actions: {flexDirection: 'row', justifyContent: 'flex-end', gap: 8},
});

const useStyles = () => useThemeStyles(makeStyles);
