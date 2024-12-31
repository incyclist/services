import { Interface } from 'readline';
import { DeviceAccessService } from './service';
import { AntInterface, InterfaceFactory } from 'incyclist-devices';

const OC = expect.objectContaining

describe('DeviceAccessService', () => {
    
  describe('enableInterface', () => {
    let service: DeviceAccessService;
    let ifaceName: string;
    let binding: any;
    let props: any;
    let mocks

    const logSpy = jest.fn()
    const eventSpy = jest.fn()

    const setupMocks =(props={}) => {
        service.logEvent = logSpy    
        service.on('interface-changed', eventSpy)

        mocks =  {
            InterfaceFactory: { create: jest.fn() },
            interface: {
                setBinding:jest.fn(),
                isConnected:jest.fn()
            }  
    
        }

        service.inject('InterfaceFactory', mocks.InterfaceFactory)
    }

    const cleanupMocks =() => {
        logSpy.mockClear()
        eventSpy.mockClear()
        service.removeAllListeners()
    }

    beforeEach(() => {
      service = new DeviceAccessService();
      ifaceName = 'test-iface';
      binding = { foo: 'bar' };
      props = { baz: 'qux' };

      setupMocks()
    });



    afterEach(() => {
        cleanupMocks()
        service.reset()
    });

    test('normal flow - disconnected interface', async () => {
        mocks.InterfaceFactory.create.mockReturnValue(mocks.interface)
        mocks.interface.isConnected.mockReturnValue(false)
        service.initInterface(ifaceName, binding, props);
        eventSpy.mockClear()

        await service.enableInterface(ifaceName);
        expect(eventSpy).toHaveBeenCalledWith('test-iface',{isScanning:false, name:'test-iface',state:'disconnected', enabled:true, interface:mocks.interface, properties:props})
        expect(logSpy).not.toHaveBeenCalled()
    });

    test('normal flow - disconnected interface with autoconnect', async () => {
        service.connect = jest.fn().mockResolvedValue(true)        
        mocks.InterfaceFactory.create.mockReturnValue(mocks.interface)
        mocks.interface.isConnected.mockReturnValue(false)

        service.initInterface(ifaceName, binding, props);
        eventSpy.mockClear()

        await service.enableInterface(ifaceName,null,{autoConnect:true});
        expect(eventSpy).toHaveBeenCalledWith('test-iface',OC({name:'test-iface',state:'disconnected'}))
        expect(eventSpy).toHaveBeenCalledWith('test-iface',OC({name:'test-iface',state:'connecting'}))
        expect(eventSpy).toHaveBeenCalledWith('test-iface',OC({name:'test-iface',state:'connected'}))
        expect(logSpy).not.toHaveBeenCalled()
    });

    test('normal flow - connected interface', async () => {
        mocks.InterfaceFactory.create.mockReturnValue(mocks.interface)
        mocks.interface.isConnected.mockReturnValue(true)
        service.initInterface(ifaceName, binding, props);
        eventSpy.mockClear()

        await service.enableInterface(ifaceName);
        expect(eventSpy).toHaveBeenCalledWith('test-iface',OC({name:'test-iface',state:'connected'}))               

        // 2nd call to enable an already enabled and connected interface, should not emit a state change
        eventSpy.mockClear()
        await service.enableInterface(ifaceName);
        expect(eventSpy).not.toHaveBeenCalled()

        // enable interface that was already enabled but lost connection
        mocks.interface.isConnected.mockReturnValue(false)
        eventSpy.mockClear()
        await service.enableInterface(ifaceName);
        expect(eventSpy).toHaveBeenCalledWith('test-iface',OC({name:'test-iface',state:'disconnected'}))               
        
    });

    test('normal flow - interface is scanning', async () => {
        mocks.InterfaceFactory.create.mockReturnValue(mocks.interface)
        mocks.interface.isConnected.mockReturnValue(true)
        service.isScanning = jest.fn().mockReturnValue(true)
        service.initInterface(ifaceName, binding, props);
        eventSpy.mockClear()

        await service.enableInterface(ifaceName);
        expect(eventSpy).not.toHaveBeenCalled()
        expect(logSpy).toHaveBeenCalledWith({message:'Illegal State, enable Interface cannot be called during an ongoing scan', interface:'test-iface'})
    
        
    });

    test('normal flow - unknown interface state', async () => {
        mocks.InterfaceFactory.create.mockReturnValue(mocks.interface)
        
        service.initInterface(ifaceName, binding, props);
        eventSpy.mockClear()

        await service.enableInterface(ifaceName);
        expect(eventSpy).toHaveBeenCalledWith('test-iface',OC({name:'test-iface',state:'disconnected'}))        
    });

    test('initial call with  no binding', async () => {
      await service.enableInterface(ifaceName);
      expect(eventSpy).toHaveBeenCalledWith('test-iface',{isScanning:false, name:'test-iface',state:'unavailable'})
      expect(logSpy).toHaveBeenCalledWith({message:'Interface has not been initialized with binding', interface:'test-iface'})
    });

    test('initial call with binding - connected interface', async () => {
        mocks.InterfaceFactory.create.mockReturnValue(mocks.interface)
        mocks.interface.isConnected.mockReturnValue(true)

        await service.enableInterface(ifaceName,binding);
        expect(eventSpy).toHaveBeenCalledWith('test-iface',OC({name:'test-iface',state:'connected'}))                      
        expect(logSpy).not.toHaveBeenCalled()
    });
  })


  /*
  describe('initInterface', () => {})
  describe('disableInterface', () => {})
  describe('setInterfaceProperties', () => {})
  describe('enrichWithAccessState', () => {})
  describe('connect', () => {})
  describe('disconnect', () => {})
  describe('scan', () => {})
  describe('scanForNew', () => {})
  describe('stopScan', () => {})
  describe('getProtocols', () => {})
  */
    
});