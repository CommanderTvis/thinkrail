import {useCallback, useEffect, useRef, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {View as MacView} from 'react-native-macos';
import type {ExistingWorktreeCandidate} from '../../../packages/contracts/src';
import {hostClient} from './HostClient';
import {Icon} from './Icon';
import {setProjectExpanded} from './railExpansion';
import {SpinningIcon} from './SpinningIcon';
import {color, useThemeStyles} from './Theme';
import type {Palette} from './themePalette';
import {tid} from './testId';

export function ExistingWorktreeDialog({projectId, onClose}: {projectId: string; onClose: () => void}) {
  const s = useStyles();
  const [candidates, setCandidates] = useState<ExistingWorktreeCandidate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const request = useRef(0);

  const load = useCallback(() => {
    const current = ++request.current;
    setCandidates(null);
    setLoadError(null);
    setOpenError(null);
    hostClient.listExistingWorktrees(projectId).then(
      rows => {if (request.current === current) setCandidates(rows);},
      error => {if (request.current === current) setLoadError(`Couldn't list existing worktrees: ${String(error)}`);},
    );
  }, [projectId]);
  const invalidate = useCallback(() => {request.current++;}, []);
  useEffect(() => {
    load();
    return invalidate;
  }, [load, invalidate]);

  const close = () => {if (openingPath === null) onClose();};
  const open = async (candidate: ExistingWorktreeCandidate) => {
    if (candidate.status !== 'available' || openingPath) return;
    setOpeningPath(candidate.path);
    setOpenError(null);
    try {
      await hostClient.openExistingWorktree(projectId, candidate.path);
      setProjectExpanded(projectId, true);
      onClose();
    } catch (error) {
      setOpenError(`Couldn't finish opening the existing worktree: ${String(error)}`);
      setOpeningPath(null);
    }
  };

  return <MacView style={s.layer} keyDownEvents={[{key: 'Escape'}]}
    onKeyDown={event => {if (event.nativeEvent.key === 'Escape') {event.stopPropagation(); close();}}}>
    <Pressable style={s.backdrop} onPress={close} />
    <View {...tid('existing-worktree-dialog')} style={s.dialog}>
      <View style={s.header}><Icon name="folderOpen" color={color.accent} size={16} /><Text style={s.title}>Open existing worktree</Text></View>
      <Text style={s.description}>Choose a checkout already registered with this Git repository. ThinkRail will use it in place without moving, renaming, or taking ownership of it.</Text>
      {candidates === null && loadError === null ? <View {...tid('existing-worktree-loading')} style={s.loading}><SpinningIcon name="loader" color={color.muted} /></View> : null}
      {loadError ? <View style={s.errorBox}>
        <Text style={s.error}>{loadError}</Text>
        <Pressable {...tid('existing-worktree-retry')} accessibilityRole="button" onPress={load} style={s.button}><Text style={s.buttonText}>Retry</Text></Pressable>
      </View> : null}
      {candidates?.length === 0 ? <View {...tid('existing-worktree-empty')} style={s.empty}>
        <Text style={s.muted}>No unattached worktrees found. Create one with Git, then reopen this chooser.</Text>
      </View> : null}
      {candidates && candidates.length > 0 ? <ScrollView {...tid('existing-worktree-list')} style={s.list} contentContainerStyle={s.listContent}>
        {candidates.map(candidate => {
          const available = candidate.status === 'available';
          return <Pressable key={candidate.path} {...tid('existing-worktree-candidate', {status: candidate.status, disabled: !available || openingPath !== null})} accessibilityRole="button"
            disabled={!available || openingPath !== null} onPress={() => open(candidate)} style={[s.candidate, !available && s.candidateDisabled]}>
            <View style={s.candidateIcon}>{openingPath === candidate.path ? <SpinningIcon name="loader" color={color.muted} />
              : <Icon name="gitBranch" color={color.muted} size={16} />}</View>
            <View style={s.candidateCopy}>
              <Text numberOfLines={1} style={s.candidateTitle}>{candidate.status === 'available' ? candidate.branch : 'Detached HEAD'}</Text>
              <Text numberOfLines={1} style={s.muted}>{candidate.path}</Text>
              {available ? null : <Text style={s.warning}>Create a branch in this worktree before opening it.</Text>}
            </View>
          </Pressable>;
        })}
      </ScrollView> : null}
      {openError ? <View {...tid('existing-worktree-error')} style={s.errorBox}><Text style={s.error}>{openError}</Text></View> : null}
      <View style={s.footer}>
        <Pressable accessibilityRole="button" disabled={openingPath !== null} onPress={close} style={s.button}><Text style={s.buttonText}>Cancel</Text></Pressable>
      </View>
    </View>
  </MacView>;
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  layer: {...StyleSheet.absoluteFillObject, zIndex: 30, alignItems: 'center', justifyContent: 'center'},
  backdrop: {...StyleSheet.absoluteFillObject, backgroundColor: '#000000a8'},
  dialog: {width: 576, maxWidth: '92%', padding: 16, gap: 12, borderWidth: 1, borderRadius: 8, borderColor: palette.borderStrong, backgroundColor: palette.elevated},
  header: {flexDirection: 'row', alignItems: 'center', gap: 8},
  title: {fontFamily: 'Geist SemiBold', fontSize: 17, color: palette.text},
  description: {fontFamily: 'Geist Native Text', fontSize: 13, lineHeight: 19, color: palette.muted},
  loading: {minHeight: 112, alignItems: 'center', justifyContent: 'center'},
  errorBox: {gap: 8, padding: 12, borderRadius: 4, backgroundColor: palette.errorBg, alignItems: 'flex-start'},
  error: {fontFamily: 'Geist Native Text', fontSize: 13, color: palette.red},
  empty: {padding: 12, borderWidth: 1, borderRadius: 4, borderColor: palette.border, backgroundColor: palette.input},
  list: {maxHeight: 384}, listContent: {gap: 4},
  candidate: {flexDirection: 'row', gap: 12, padding: 12, borderWidth: 1, borderRadius: 4, borderColor: palette.border, backgroundColor: palette.input},
  candidateDisabled: {opacity: 0.6},
  candidateIcon: {width: 28, height: 28, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.elevated},
  candidateCopy: {flex: 1, minWidth: 0, gap: 2},
  candidateTitle: {fontFamily: 'Geist Native Text', fontSize: 14, color: palette.text},
  muted: {fontFamily: 'Geist Native Text', fontSize: 12, color: palette.muted},
  warning: {fontFamily: 'Geist Native Text', fontSize: 12, color: palette.warning},
  footer: {flexDirection: 'row', justifyContent: 'flex-end'},
  button: {paddingHorizontal: 12, paddingVertical: 7, borderRadius: 4, borderWidth: 1, borderColor: palette.borderStrong},
  buttonText: {fontFamily: 'Geist Native Text', fontSize: 13, color: palette.text},
});

const useStyles = () => useThemeStyles(makeStyles);
