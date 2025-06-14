import { useState, useEffect, useRef, useCallback } from 'react';
import { Signal } from '@/types/signal';
import { checkSignalTime } from '@/utils/signalUtils';
import { playCustomRingtone } from '@/utils/audioUtils';
import { requestWakeLock, releaseWakeLock } from '@/utils/wakeLockUtils';
import { useAudioManager } from './useAudioManager';

export const useRingManager = (
  savedSignals: Signal[],
  antidelaySeconds: number,
  onSignalTriggered: (signal: Signal) => void
) => {
  const [isRinging, setIsRinging] = useState(false);
  const [currentRingingSignal, setCurrentRingingSignal] = useState<Signal | null>(null);
  const [wakeLock, setWakeLock] = useState<WakeLockSentinel | null>(null);
  const [ringOffButtonPressed, setRingOffButtonPressed] = useState(false);
  const [alreadyRangIds, setAlreadyRangIds] = useState<Set<string>>(new Set());

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const audioInstancesRef = useRef<HTMLAudioElement[]>([]);
  const audioContextsRef = useRef<AudioContext[]>([]);
  const { customRingtone } = useAudioManager();

  // Helper: construct unique signal ID
  function getSignalId(signal: Signal): string {
    return `${signal.asset}-${signal.direction}-${signal.timestamp}`;
  }

  // Ring notification - use useCallback to ensure it gets fresh customRingtone
  const triggerRing = useCallback(async (signal: Signal) => {
    console.log('🔔 TRIGGER RING - Custom ringtone available:', !!customRingtone);
    console.log('🔔 Custom ringtone data length:', customRingtone?.length || 0);
    
    setIsRinging(true);
    setCurrentRingingSignal(signal);

    // Wake up screen if supported
    const lock = await requestWakeLock();
    setWakeLock(lock);

    if (document.hidden) {
      window.focus();
    }

    // Play custom ringtone or default beep and track audio instances
    console.log('🔔 About to call playCustomRingtone with:', customRingtone ? 'CUSTOM_RINGTONE' : 'NULL');
    const audio = await playCustomRingtone(customRingtone, audioContextsRef);
    if (audio instanceof HTMLAudioElement) {
      audioInstancesRef.current.push(audio);
    }

    // Mark signal as triggered so we can't ring again for this timestamp
    onSignalTriggered(signal);
    setAlreadyRangIds((prev) => {
      const newSet = new Set(prev);
      newSet.add(getSignalId(signal));
      return newSet;
    });
  }, [customRingtone, onSignalTriggered]); // Add customRingtone as dependency

  // Check signals every second for precise timing
  useEffect(() => {
    if (savedSignals.length > 0) {
      console.log('🔔 Setting up signal checking interval...');
      intervalRef.current = setInterval(() => {
        savedSignals.forEach(signal => {
          if (
            checkSignalTime(signal, antidelaySeconds) && 
            !alreadyRangIds.has(getSignalId(signal))
          ) {
            console.log('🔔 Signal time reached, triggering ring for:', signal);
            triggerRing(signal);
          }
        });
      }, 1000);

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      };
    }
  }, [savedSignals, antidelaySeconds, alreadyRangIds, triggerRing]); // Add triggerRing as dependency

  // Ring off button handler - stops ALL audio immediately
  const handleRingOff = () => {
    setRingOffButtonPressed(true);
    setTimeout(() => setRingOffButtonPressed(false), 200);

    // Stop ALL audio instances immediately
    audioInstancesRef.current.forEach(audio => {
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
    });
    audioInstancesRef.current = [];

    // Stop ALL Web Audio API contexts
    audioContextsRef.current.forEach(context => {
      if (context && context.state !== 'closed') {
        context.close().catch(err => console.log('Audio context cleanup error:', err));
      }
    });
    audioContextsRef.current = [];

    // Additional cleanup: Stop any remaining audio elements on the page
    const allAudioElements = document.querySelectorAll('audio');
    allAudioElements.forEach(audio => {
      audio.pause();
      audio.currentTime = 0;
    });

    // Stop ringing if currently ringing
    if (isRinging) {
      setIsRinging(false);
      setCurrentRingingSignal(null);
      releaseWakeLock(wakeLock);
      setWakeLock(null);
    }
  };

  return {
    isRinging,
    currentRingingSignal,
    ringOffButtonPressed,
    handleRingOff
  };
};
