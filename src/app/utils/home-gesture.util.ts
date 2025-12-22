import { ElementRef, QueryList } from '@angular/core';
import { Gesture, GestureController } from '@ionic/angular';

export interface LongPressConfig {
  delayMs: number;
  moveTolerancePx: number;
  startDelayMs: number;
}

/**
 * Creates and enables a long-press gesture on an element.
 * Calls onTrigger(nativeEl) when long-press threshold is met.
 * Calls onFinalize() after pointer up if long-press actually triggered.
 */
export function createLongPressGesture(
  element: ElementRef,
  gestureCtrl: GestureController,
  onTrigger: (nativeEl: any) => void,
  onFinalize: () => void,
  cfg: LongPressConfig
): Gesture {
  let timeout: any;
  let isLongPress = false;
  let startX = 0;
  let startY = 0;

  const gesture = gestureCtrl.create({
    el: element.nativeElement,
    threshold: 0,
    gestureName: 'long-press',
    onStart: (detail) => {
      startX = detail.currentX;
      startY = detail.currentY;
      timeout = setTimeout(() => {
        isLongPress = true;
        onTrigger(element.nativeElement);
      }, cfg.delayMs);
    },
    onMove: (detail) => {
      const moveX = Math.abs(detail.currentX - startX);
      const moveY = Math.abs(detail.currentY - startY);
      if (moveX > cfg.moveTolerancePx || moveY > cfg.moveTolerancePx) {
        clearTimeout(timeout);
      }
    },
    onEnd: () => {
      clearTimeout(timeout);
      if (isLongPress) onFinalize();
      isLongPress = false;
    },
  });

  gesture.enable();
  return gesture;
}

export function initializePressGestures(
  elements: QueryList<ElementRef> | undefined | null,
  gestureCtrl: GestureController,
  onTrigger: (nativeEl: any) => void,
  onFinalize: () => void,
  cfg: LongPressConfig
): void {
  elements?.forEach((el) => {
    createLongPressGesture(el, gestureCtrl, onTrigger, onFinalize, cfg);
  });
}
