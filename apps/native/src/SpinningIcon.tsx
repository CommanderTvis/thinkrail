import {useEffect, useRef} from 'react';
import {Animated, Easing} from 'react-native';
import {Icon, type IconName} from './Icon';

export function SpinningIcon({name, color, size = 14}: {name: IconName; color: string; size?: number}) {
  const rotation = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.loop(Animated.timing(rotation, {toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: true, isInteraction: false}));
    animation.start(); return () => animation.stop();
  }, [rotation]);
  return <Animated.View style={{transform: [{rotate: rotation.interpolate({inputRange: [0, 1], outputRange: ['0deg', '360deg']})}]}}>
    <Icon name={name} color={color} size={size} />
  </Animated.View>;
}
