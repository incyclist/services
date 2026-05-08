import { LocalizationService } from './service';
import { LocalizedText } from './types';

describe('LocalizationService', () => {
  let service: LocalizationService;
  let mockUserSettings: any;
  let mockUIBinding: any;

  beforeEach(() => {
    // Create mocks for dependencies
    mockUserSettings = {
      getValue: jest.fn().mockReturnValue(undefined),
      set: jest.fn(),
    };

    mockUIBinding = {
      detectLanguage: jest.fn().mockReturnValue([]),
    };

    // Create service instance
    service = new LocalizationService();

    // Mock the protected methods using Object.defineProperty
    jest.spyOn(service as any, 'getUserSettings').mockReturnValue(mockUserSettings);
    jest.spyOn(service as any, 'getUIBinding').mockReturnValue(mockUIBinding);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getLanguage', () => {
    test('returns selected language if available', () => {
      mockUserSettings.getValue.mockImplementation((key: string) => {
        if (key === 'preferences.language') return 'fr';
        return undefined;
      });

      const result = service.getLanguage('en');

      expect(result).toBe('fr');
      expect(mockUserSettings.getValue).toHaveBeenCalledWith('preferences.language', undefined);
    });

    test('returns detected language when no preference is set', () => {
      mockUserSettings.getValue.mockImplementation((key: string) => {
        if (key === 'preferences.language') return undefined;
        if (key === 'localization.language') return undefined;
        return undefined;
      });
      mockUIBinding.detectLanguage.mockReturnValue(['de', 'en']);

      const result = service.getLanguage('en');

      expect(result).toBe('de');
      expect(mockUserSettings.set).toHaveBeenCalledWith('localization.language', 'de', true);
    });

    test('returns stored language when no preference or detection available', () => {
      mockUserSettings.getValue.mockImplementation((key: string) => {
        if (key === 'preferences.language') return undefined;
        if (key === 'localization.language') return 'es';
        return undefined;
      });
      mockUIBinding.detectLanguage.mockReturnValue([]);

      const result = service.getLanguage('en');

      expect(result).toBe('es');
    });

    test('returns default language when no other source available', () => {
      mockUserSettings.getValue.mockReturnValue(undefined);
      mockUIBinding.detectLanguage.mockReturnValue([]);

      const result = service.getLanguage('en');

      expect(result).toBe('en');
    });

    test('returns default language when detected is empty array', () => {
      mockUserSettings.getValue.mockReturnValue(undefined);
      mockUIBinding.detectLanguage.mockReturnValue([]);

      const result = service.getLanguage('pt');

      expect(result).toBe('pt');
    });
  });

  describe('setSelectedLanguage', () => {
    test('saves language to preferences', () => {
      service.setSelectedLanguage('fr');

      expect(mockUserSettings.set).toHaveBeenCalledWith('preferences.language', 'fr', true);
    });

    test('saves multiple languages sequentially', () => {
      service.setSelectedLanguage('de');
      service.setSelectedLanguage('es');

      expect(mockUserSettings.set).toHaveBeenCalledTimes(2);
      expect(mockUserSettings.set).toHaveBeenNthCalledWith(1, 'preferences.language', 'de', true);
      expect(mockUserSettings.set).toHaveBeenNthCalledWith(2, 'preferences.language', 'es', true);
    });
  });

  describe('setDetectedLanguage', () => {
    test('saves detected language to localization settings', () => {
      service.setDetectedLanguage('ja');

      expect(mockUserSettings.set).toHaveBeenCalledWith('localization.language', 'ja', true);
    });

    test('saves multiple detected languages sequentially', () => {
      service.setDetectedLanguage('zh');
      service.setDetectedLanguage('ko');

      expect(mockUserSettings.set).toHaveBeenCalledTimes(2);
      expect(mockUserSettings.set).toHaveBeenNthCalledWith(1, 'localization.language', 'zh', true);
      expect(mockUserSettings.set).toHaveBeenNthCalledWith(2, 'localization.language', 'ko', true);
    });
  });

  describe('getSelectedLanguage', () => {
    test('returns selected language when set', () => {
      mockUserSettings.getValue.mockReturnValue('fr');

      const result = service.getSelectedLanguage();

      expect(result).toBe('fr');
      expect(mockUserSettings.getValue).toHaveBeenCalledWith('preferences.language', undefined);
    });

    test('returns undefined when no selection made', () => {
      mockUserSettings.getValue.mockReturnValue(undefined);

      const result = service.getSelectedLanguage();

      expect(result).toBeUndefined();
    });

    test('returns empty string when explicitly set', () => {
      mockUserSettings.getValue.mockReturnValue('');

      const result = service.getSelectedLanguage();

      expect(result).toBe('');
    });
  });

  describe('getCurrentLanguage', () => {
    test('returns preferred language when available', () => {
      mockUserSettings.getValue.mockImplementation((key: string) => {
        if (key === 'preferences.language') return 'fr';
        return undefined;
      });
      mockUIBinding.detectLanguage.mockReturnValue(['de', 'en']);

      const result = service.getCurrentLanguage();

      expect(result).toBe('fr');
    });

    test('returns detected array when preference not set and detection available', () => {
      mockUserSettings.getValue.mockReturnValue(undefined);
      const detected = ['de', 'en'];
      mockUIBinding.detectLanguage.mockReturnValue(detected);

      const result = service.getCurrentLanguage();

      expect(result).toBe(detected);
    });

    test('returns stored language when no preference and no detection', () => {
      mockUserSettings.getValue.mockImplementation((key: string) => {
        if (key === 'localization.language') return 'es';
        return undefined;
      });
      mockUIBinding.detectLanguage.mockReturnValue(undefined);

      const result = service.getCurrentLanguage();

      expect(result).toBe('es');
    });

    test('returns undefined when no language available', () => {
      mockUserSettings.getValue.mockReturnValue(undefined);
      mockUIBinding.detectLanguage.mockReturnValue(undefined);

      const result = service.getCurrentLanguage();

      expect(result).toBeUndefined();
    });

    test('prefers preference over detected over stored', () => {
      mockUserSettings.getValue.mockImplementation((key: string) => {
        if (key === 'preferences.language') return 'fr';
        if (key === 'localization.language') return 'es';
        return undefined;
      });
      mockUIBinding.detectLanguage.mockReturnValue(['de', 'en']);

      const result = service.getCurrentLanguage();

      expect(result).toBe('fr');
    });

    test('prefers detected over stored when no preference', () => {
      mockUserSettings.getValue.mockImplementation((key: string) => {
        if (key === 'preferences.language') return undefined;
        if (key === 'localization.language') return 'es';
        return undefined;
      });
      const detected = ['de', 'en'];
      mockUIBinding.detectLanguage.mockReturnValue(detected);

      const result = service.getCurrentLanguage();

      expect(result).toBe(detected);
    });
  });

  describe('getLocalized', () => {
    test('returns text in specified language', () => {
      const text: LocalizedText = { en: 'Hello', fr: 'Bonjour', de: 'Hallo' };

      const result = service.getLocalized(text, 'fr');

      expect(result).toBe('Bonjour');
    });

    test('returns text in current language when not specified', () => {
      mockUserSettings.getValue.mockImplementation((key: string) => {
        if (key === 'preferences.language') return 'de';
        return undefined;
      });
      mockUIBinding.detectLanguage.mockReturnValue([]);
      const text: LocalizedText = { en: 'Hello', fr: 'Bonjour', de: 'Hallo' };

      const result = service.getLocalized(text);

      expect(result).toBe('Hallo');
    });

    test('falls back to detected language when requested language not found', () => {
      mockUIBinding.detectLanguage.mockReturnValue(['de', 'en']);
      const text: LocalizedText = { en: 'Hello', de: 'Hallo' };

      const result = service.getLocalized(text, 'fr');

      expect(result).toBe('Hallo');
    });

    test('falls back through multiple detected languages', () => {
      mockUIBinding.detectLanguage.mockReturnValue(['ja', 'es', 'de', 'en']);
      const text: LocalizedText = { en: 'Hello', de: 'Hallo' };

      const result = service.getLocalized(text, 'fr');

      expect(result).toBe('Hallo');
    });

    test('returns English as final fallback', () => {
      mockUIBinding.detectLanguage.mockReturnValue(['ja']);
      const text: LocalizedText = { en: 'Hello', de: 'Hallo' };

      const result = service.getLocalized(text, 'fr');

      expect(result).toBe('Hello');
    });

    test('returns undefined when English not available', () => {
      mockUIBinding.detectLanguage.mockReturnValue(['ja']);
      const text: LocalizedText = { fr: 'Bonjour', de: 'Hallo' };

      const result = service.getLocalized(text, 'es');

      expect(result).toBeUndefined();
    });

    test('handles text object with single language', () => {
      mockUIBinding.detectLanguage.mockReturnValue([]);
      const text: LocalizedText = { en: 'Hello' };

      const result = service.getLocalized(text, 'fr');

      expect(result).toBe('Hello');
    });

    test('returns first detected language when current language not in text', () => {
      mockUserSettings.getValue.mockReturnValue(undefined);
      mockUIBinding.detectLanguage.mockReturnValue(['es', 'de']);
      const text: LocalizedText = { en: 'Hello', es: 'Hola', de: 'Hallo' };

      const result = service.getLocalized(text);

      expect(result).toBe('Hola');
    });

    test('returns current language even when detected available', () => {
      mockUserSettings.getValue.mockImplementation((key: string) => {
        if (key === 'preferences.language') return 'de';
        return undefined;
      });
      mockUIBinding.detectLanguage.mockReturnValue(['es', 'en']);
      const text: LocalizedText = { en: 'Hello', es: 'Hola', de: 'Hallo' };

      const result = service.getLocalized(text);

      expect(result).toBe('Hallo');
    });
  });

  describe('translate', () => {
    test('method exists', () => {
      expect(service.translate).toBeDefined();
    });
  });

  describe('init', () => {
    test('method exists', () => {
      expect(service.init).toBeDefined();
    });
  });
});
