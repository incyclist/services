import { MultipleXMLParser } from './multixml';
import { XMLParser } from './xml';
import { FileInfo } from '../../../api';
import { XmlJSON, parseXml } from '../../../utils/xml';
import { getUtf8Data } from './utils';
import * as api from '../../../api';
import { ParseResult, Parser } from './types';
import { RouteApiDetail } from '../api/types';

jest.mock('./utils');
jest.mock('../../../utils/xml');
jest.mock('../../../api');

describe('MultipleXMLParser', () => {
  let mockParser1: jest.Mocked<XMLParser>;
  let mockParser2: jest.Mocked<XMLParser>;
  let mockFileInfo: FileInfo;
  let mockXmlData: XmlJSON;
  let mockParseResult: ParseResult<RouteApiDetail>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock parsers
    mockParser1 = {
      supportsContent: jest.fn(),
      import: jest.fn(),
    } as any;

    mockParser2 = {
      supportsContent: jest.fn(),
      import: jest.fn(),
    } as any;

    // Setup mock file info
    mockFileInfo = {
      name: 'test.xml',
      path: '/path/to/test.xml',
    } as any;

    // Setup mock XML data
    mockXmlData = {
      root: {
        element: 'value',
      },
    } as any;

    // Setup mock parse result
    mockParseResult = {
      data: {},
    } as any;

    // Mock getBindings to return a loader
    const mockLoader = {
      open: jest.fn().mockResolvedValue({
        data: Buffer.from('<xml></xml>'),
        error: null,
      }),
    };

    (api.getBindings as jest.Mock).mockReturnValue({
      loader: mockLoader,
    });

    (getUtf8Data as jest.Mock).mockReturnValue('<xml></xml>');
    (parseXml as jest.Mock).mockResolvedValue(mockXmlData);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    test('instantiate parsers from provided classes', () => {
      const XMLParserClass1 = jest.fn(() => mockParser1);
      const XMLParserClass2 = jest.fn(() => mockParser2);

      const parser = new MultipleXMLParser([
        XMLParserClass1 as any,
        XMLParserClass2 as any,
      ]);

      expect(XMLParserClass1).toHaveBeenCalled();
      expect(XMLParserClass2).toHaveBeenCalled();
      expect(parser['parsers']).toHaveLength(2);
    });

    test('handle empty parser classes array', () => {
      const parser = new MultipleXMLParser([]);
      expect(parser['parsers']).toHaveLength(0);
    });

    test('store parser instances in correct order', () => {
      const XMLParserClass1 = jest.fn(() => mockParser1);
      const XMLParserClass2 = jest.fn(() => mockParser2);

      const parser = new MultipleXMLParser([
        XMLParserClass1 as any,
        XMLParserClass2 as any,
      ]);

      expect(parser['parsers'][0]).toBe(mockParser1);
      expect(parser['parsers'][1]).toBe(mockParser2);
    });
  });

  describe('import', () => {
    test('find parser supporting content and call its import method', async () => {
      mockParser1.supportsContent.mockReturnValue(false);
      mockParser2.supportsContent.mockReturnValue(true);
      mockParser2.import.mockResolvedValue(mockParseResult);

      const XMLParserClass1 = jest.fn(() => mockParser1);
      const XMLParserClass2 = jest.fn(() => mockParser2);
      const parser = new MultipleXMLParser([
        XMLParserClass1 as any,
        XMLParserClass2 as any,
      ]);

      const result = await parser.import(mockFileInfo, mockXmlData);

      expect(mockParser1.supportsContent).toHaveBeenCalledWith(mockXmlData);
      expect(mockParser2.supportsContent).toHaveBeenCalledWith(mockXmlData);
      expect(mockParser2.import).toHaveBeenCalledWith(mockFileInfo, mockXmlData);
      expect(result).toBe(mockParseResult);
    });

    test('load XML data from file when not provided', async () => {
      mockParser1.supportsContent.mockReturnValue(true);
      mockParser1.import.mockResolvedValue(mockParseResult);

      const XMLParserClass1 = jest.fn(() => mockParser1);
      const parser = new MultipleXMLParser([XMLParserClass1 as any]);

      const result = await parser.import(mockFileInfo);

      expect(parseXml).toHaveBeenCalledWith('<xml></xml>');
      expect(mockParser1.import).toHaveBeenCalledWith(mockFileInfo, mockXmlData);
      expect(result).toBe(mockParseResult);
    });

    test('use provided XML data without loading from file', async () => {
      mockParser1.supportsContent.mockReturnValue(true);
      mockParser1.import.mockResolvedValue(mockParseResult);

      const XMLParserClass1 = jest.fn(() => mockParser1);
      const parser = new MultipleXMLParser([XMLParserClass1 as any]);

      const result = await parser.import(mockFileInfo, mockXmlData);

      expect(api.getBindings).not.toHaveBeenCalled();
      expect(parseXml).not.toHaveBeenCalled();
      expect(mockParser1.import).toHaveBeenCalledWith(mockFileInfo, mockXmlData);
      expect(result).toBe(mockParseResult);
    });

    test('throw error when no suitable parser found', async () => {
      mockParser1.supportsContent.mockReturnValue(false);

      const XMLParserClass1 = jest.fn(() => mockParser1);
      const parser = new MultipleXMLParser([XMLParserClass1 as any]);

      await expect(parser.import(mockFileInfo, mockXmlData)).rejects.toThrow();
    });
  });

  describe('supportsExtension', () => {
    test('return true for xml extension', () => {
      const parser = new MultipleXMLParser([]);
      expect(parser.supportsExtension('xml')).toBe(true);
    });

    test('return true for XML extension in uppercase', () => {
      const parser = new MultipleXMLParser([]);
      expect(parser.supportsExtension('XML')).toBe(true);
    });

    test('return true for XmL extension in mixed case', () => {
      const parser = new MultipleXMLParser([]);
      expect(parser.supportsExtension('XmL')).toBe(true);
    });

    test('return false for non-xml extension', () => {
      const parser = new MultipleXMLParser([]);
      expect(parser.supportsExtension('json')).toBe(false);
    });

    test('return false for empty string', () => {
      const parser = new MultipleXMLParser([]);
      expect(parser.supportsExtension('')).toBe(false);
    });

    test('return false for undefined extension', () => {
      const parser = new MultipleXMLParser([]);
      expect(parser.supportsExtension(undefined as any)).toBe(false);
    });
  });

  describe('getPrimaryExtension', () => {
    test('return xml as primary extension', () => {
      const parser = new MultipleXMLParser([]);
      expect(parser.getPrimaryExtension()).toBe('xml');
    });
  });

  describe('getCompanionExtensions', () => {
    test('return empty array', () => {
      const parser = new MultipleXMLParser([]);
      const extensions = parser.getCompanionExtensions();
      expect(extensions).toEqual([]);
      expect(Array.isArray(extensions)).toBe(true);
    });
  });

  describe('supportsContent', () => {
    test('return true', () => {
      const parser = new MultipleXMLParser([]);
      expect(parser.supportsContent()).toBe(true);
    });

    test('always return true for any XML content', () => {
      const parser = new MultipleXMLParser([]);
      expect(parser.supportsContent()).toBe(true);
    });
  });

  describe('getData', () => {
    test('return provided XML data without loading from file', async () => {
      const parser = new MultipleXMLParser([]);
      const result = await parser.getData(mockFileInfo, mockXmlData);

      expect(result).toBe(mockXmlData);
      expect(api.getBindings).not.toHaveBeenCalled();
    });

    test('load XML data from file when no data provided', async () => {
      const parser = new MultipleXMLParser([]);
      const result = await parser.getData(mockFileInfo);

      expect(api.getBindings).toHaveBeenCalled();
      expect(getUtf8Data).toHaveBeenCalled();
      expect(parseXml).toHaveBeenCalledWith('<xml></xml>');
      expect(result).toBe(mockXmlData);
    });

    test('throw error when file cannot be opened', async () => {
      const mockLoader = {
        open: jest.fn().mockResolvedValue({
          data: null,
          error: 'File not found',
        }),
      };

      (api.getBindings as jest.Mock).mockReturnValue({
        loader: mockLoader,
      });

      const parser = new MultipleXMLParser([]);

      await expect(parser.getData(mockFileInfo)).rejects.toThrow(
        'Could not open file'
      );
    });

    test('apply UTF8 cleaning to file data before parsing', async () => {
      const cleanedData = '<xml cleaned></xml>';
      (getUtf8Data as jest.Mock).mockReturnValue(cleanedData);

      const parser = new MultipleXMLParser([]);
      await parser.getData(mockFileInfo);

      expect(getUtf8Data).toHaveBeenCalledWith(Buffer.from('<xml></xml>'));
      expect(parseXml).toHaveBeenCalledWith(cleanedData);
    });

    test('handle undefined data parameter', async () => {
      const parser = new MultipleXMLParser([]);
      const result = await parser.getData(mockFileInfo, undefined);

      expect(api.getBindings).toHaveBeenCalled();
      expect(result).toBe(mockXmlData);
    });
  });
});
