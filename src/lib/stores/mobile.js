import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';

// Create a store for viewport information
function createViewportStore() {
  const { subscribe, set } = writable({
    width: browser ? window.innerWidth : 1024,
    height: browser ? window.innerHeight : 768
  });
  
  if (browser) {
    const handleResize = () => {
      set({
        width: window.innerWidth,
        height: window.innerHeight
      });
    };
    
    window.addEventListener('resize', handleResize);
  }
  
  return { subscribe };
}

// Create viewport store
export const viewport = createViewportStore();

// Derived stores for different breakpoints
export const isMobile = derived(
  viewport,
  $viewport => $viewport.width < 768
);

export const isTablet = derived(
  viewport,
  $viewport => $viewport.width >= 768 && $viewport.width < 1024
);

export const isDesktop = derived(
  viewport,
  $viewport => $viewport.width >= 1024
);

export const isSmallPhone = derived(
  viewport,
  $viewport => $viewport.width < 375
);

// Touch detection
export const hasTouch = writable(
  browser ? 'ontouchstart' in window : false
);

// iOS detection (useful for specific iOS quirks)
export const isIOS = writable(
  browser ? /iPhone|iPad|iPod/.test(navigator.userAgent) : false
);

// Android detection
export const isAndroid = writable(
  browser ? /Android/.test(navigator.userAgent) : false
);

// Utility function to get safe area insets
export function getSafeAreaInsets() {
  if (!browser) return { top: 0, right: 0, bottom: 0, left: 0 };
  
  const computed = getComputedStyle(document.documentElement);
  return {
    top: parseInt(computed.getPropertyValue('--safe-top') || '0'),
    right: parseInt(computed.getPropertyValue('--safe-right') || '0'),
    bottom: parseInt(computed.getPropertyValue('--safe-bottom') || '0'),
    left: parseInt(computed.getPropertyValue('--safe-left') || '0')
  };
}

// Utility to prevent body scroll (useful for modals)
export function lockBodyScroll(lock = true) {
  if (!browser) return;
  
  if (lock) {
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
  } else {
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.width = '';
  }
}

// Haptic feedback for supported devices
export function hapticFeedback(type = 'light') {
  if (!browser) return;
  
  // For iOS devices with Taptic Engine
  if (window.navigator && window.navigator.vibrate) {
    const patterns = {
      light: 10,
      medium: 20,
      heavy: 30,
      success: [10, 30, 10],
      warning: [20, 10, 20],
      error: [30, 10, 30, 10, 30]
    };
    
    window.navigator.vibrate(patterns[type] || patterns.light);
  }
}