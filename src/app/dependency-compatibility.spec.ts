import { Network } from '@capacitor/network';
import { Preferences } from '@capacitor/preferences';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { PsmZxcvbnService } from './services/psm-zxcvbn.service';

describe('Desktop dependency compatibility', () => {
  it('reads existing Capacitor preference keys and removes only its test key', async () => {
    const key = 'stellar-peer-test-' + Date.now();
    localStorage.setItem('CapacitorStorage.' + key, 'existing-value');
    try {
      expect((await Preferences.get({ key })).value).toBe('existing-value');
      await Preferences.set({ key, value: 'updated-value' });
      expect(localStorage.getItem('CapacitorStorage.' + key)).toBe('updated-value');
    } finally {
      await Preferences.remove({ key });
    }
  });

  it('round-trips HTML and Unicode through the filesystem web implementation', async () => {
    const path = 'stellar-peer-test-' + Date.now() + '.txt';
    const data = '<p>æøå 😀</p><p>second line</p>';
    await Filesystem.writeFile({ path, directory: Directory.Data, data, encoding: Encoding.UTF8 });
    try {
      expect((await Filesystem.readFile({ path, directory: Directory.Data, encoding: Encoding.UTF8 })).data).toBe(data);
      expect((await Filesystem.readdir({ path: '', directory: Directory.Data })).files.some(file => file.name === path)).toBeTrue();
    } finally {
      await Filesystem.deleteFile({ path, directory: Directory.Data });
    }
  });

  it('reports browser connectivity and delivers the reconnect event used by sync', async () => {
    expect((await Network.getStatus()).connected).toBe(navigator.onLine);
    const observed: boolean[] = [];
    const listener = await Network.addListener('networkStatusChange', state => observed.push(state.connected));
    try {
      window.dispatchEvent(new Event('online'));
      expect(observed).toEqual([true]);
    } finally {
      await listener.remove();
    }
  });

  it('checks share availability without opening a share dialog', async () => {
    expect((await Share.canShare()).value).toBe(typeof navigator.share === 'function');
  });

  it('keeps the password score and feedback contract used by Angular', async () => {
    const meter = new PsmZxcvbnService();
    expect(meter.score('')).toBe(0);
    const password = 'qa-only-X7!pR92$Lm8@vT';
    expect(meter.score(password)).toBeGreaterThan(meter.score('aaaa'));
    expect(await meter.scoreAsync(password)).toBe(meter.score(password));
    const result = await meter.scoreWithFeedbackAsync(password);
    expect(result.score).toBe(meter.score(password));
    expect(typeof result.feedback.warning).toBe('string');
    expect(Array.isArray(result.feedback.suggestions)).toBeTrue();
  });
});
