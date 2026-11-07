import { describe, it, expect, vi } from 'vitest';
import { reportTranslationProgress } from '../src/reader.mjs';

/* The translation queue keeps reporting after playback starts: it translates the
 * window ahead of the cursor as the reader listens. Each report used to repaint
 * the toolbar as `playing: false`, so a reader listening in Deutsch saw "▶ Play"
 * and "Translating into Deutsch (100%)" while the audio ran, and pressing the
 * button (or Space) called play instead of pause. Found by TestSprite on LT-255
 * and reproduced locally in Chrome. */
describe('reportTranslationProgress', () => {
  const progress = { loaded: 1, total: 2 };

  it('shows the progress line while the reader waits for the first translation', () => {
    const controls = { setState: vi.fn() };
    reportTranslationProgress({ controls, playing: false, label: 'Deutsch', progress });
    expect(controls.setState).toHaveBeenCalledWith({
      playing: false, buffering: true, message: 'Translating into Deutsch (50%)',
    });
  });

  it('leaves the toolbar alone while audio is playing', () => {
    const controls = { setState: vi.fn() };
    reportTranslationProgress({ controls, playing: true, label: 'Deutsch', progress });
    expect(controls.setState).not.toHaveBeenCalled();
  });
});
