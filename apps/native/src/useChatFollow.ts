import {useCallback, useEffect, useRef, useState} from 'react';
import {ScrollView, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent} from 'react-native';
import {followTarget, type StreamingMovement} from './chatMovement';
import type {ChatMessageOrder} from './chatRows';

export function useChatFollow(sessionId: string, order: ChatMessageOrder, streaming: boolean, movement: StreamingMovement) {
  const transcript = useRef<ScrollView>(null);
  const [height, setHeight] = useState(0);
  const [following, setFollowing] = useState(true);
  const geometry = useRef({height: 0, contentHeight: 0, edgeBottom: 0, offset: 0});
  const follows = useRef(true);
  const expectedOffsets = useRef<number[]>([]);
  const latestRow = useRef('');
  const context = useRef('');
  const move = useCallback((target: number) => {
    if (Math.abs(target - geometry.current.offset) <= 0.5 || expectedOffsets.current.at(-1) === target) return;
    expectedOffsets.current.push(target);
    transcript.current?.scrollTo({y: target, animated: false});
  }, []);
  const update = useCallback((force = false) => {
    const target = followTarget({...geometry.current, streaming, following: follows.current, order, movement, force});
    if (target !== null) move(target);
  }, [streaming, order, movement, move]);
  useEffect(() => {
    const nextContext = JSON.stringify([sessionId, order]);
    if (context.current === nextContext) return;
    context.current = nextContext;
    follows.current = true;
    setFollowing(true);
    latestRow.current = '';
    expectedOffsets.current = [];
    update(true);
  }, [sessionId, order, update]);
  useEffect(() => {update();}, [update]);
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = Math.max(0, event.nativeEvent.contentOffset.y);
    geometry.current.offset = offset;
    const expectedIndex = expectedOffsets.current.findIndex(expected => Math.abs(offset - expected) <= 1);
    if (expectedIndex >= 0) {
      expectedOffsets.current.splice(0, expectedIndex + 1);
      return;
    }
    expectedOffsets.current = [];
    const atEdge = order === 'newest-first' ? offset <= 1
      : geometry.current.contentHeight - geometry.current.height - offset <= 1;
    follows.current = atEdge;
    setFollowing(atEdge);
  };
  const onLatestLayout = (id: string, event: LayoutChangeEvent) => {
    const {y, height: rowHeight} = event.nativeEvent.layout;
    geometry.current.edgeBottom = y + rowHeight;
    const newTop = latestRow.current !== id && order === 'newest-first';
    latestRow.current = id;
    if (newTop && follows.current) move(0);
    else update();
  };
  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.height;
    geometry.current.height = next;
    setHeight(next);
    update();
  };
  const onContentSizeChange = (_width: number, contentHeight: number) => {
    geometry.current.contentHeight = contentHeight;
    update();
  };
  const returnToLatest = () => {
    follows.current = true;
    setFollowing(true);
    update(true);
  };
  return {transcript, following, onScroll, onLatestLayout, onLayout, onContentSizeChange, returnToLatest,
    runway: streaming ? height * (1 - movement.settle / 100) : 0};
}
