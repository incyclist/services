// services.unit.test.ts

import { OnlineStateMonitoringService, useOnlineStatusMonitoring } from './service';

describe('OnlineStateMonitoringService', () => {
    let service: OnlineStateMonitoringService;
    let s
    beforeEach(() => {
        s = service = new OnlineStateMonitoringService();
    });

    afterEach( () => {
        s.reset()
    })

    test('emit onlineStatus', () => {
        const observer = service.observer;
        const callback = jest.fn();
        observer.on('onlineStatus', callback);
        service.setOnline(true);
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith(true);
    });

    test('get onlineStatus', () => {
        service.setOnline(true);
        expect(service.onlineStatus).toBe(true);
    });

    test('emit onlineStatus only when changed', () => {
        const observer = service.observer;
        const callback = jest.fn();
        observer.on('onlineStatus', callback);
        service.setOnline(true);
        service.setOnline(true);
        expect(callback).toHaveBeenCalledTimes(1);
    });

    test('emit onlineStatus with undefined initial value', () => {
        const observer = service.observer;
        const callback = jest.fn();
        observer.on('onlineStatus', callback);
        service.setOnline(true);
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith(true);
    });

    describe( 'start', () => {
        let service: OnlineStateMonitoringService;
        let s
        beforeEach(() => {
            s = service = new OnlineStateMonitoringService();
        });
    
        afterEach( () => {
            s.reset()
        })

        test('should start listening to online status changes for a context', () => {
            const context = 'test-context';
            const onlineStatusChanged = jest.fn();
            service.start(context, onlineStatusChanged);  
    
            service.setOnline(true);
            expect(onlineStatusChanged).toHaveBeenCalledTimes(1);
            expect(onlineStatusChanged).toHaveBeenCalledWith(true);
        });
    
        test('should stop listening to online status changes for a context if already started', () => {
            const context = 'test-context';
            const onlineStatusChanged1 = jest.fn();
            const onlineStatusChanged2 = jest.fn();
            service.start(context, onlineStatusChanged1);
            service.start(context, onlineStatusChanged2);
    
            service.setOnline(true);
            expect(onlineStatusChanged1).not.toHaveBeenCalled();
            expect(onlineStatusChanged2).toHaveBeenCalledTimes(1);
            expect(onlineStatusChanged2).toHaveBeenCalledWith(true);
        });
    
        test('should return the observer instance', () => {
            const context = 'test-context';
            const onlineStatusChanged = jest.fn();
            const observer = service.start(context, onlineStatusChanged);
    
            expect(observer).toBe(service.observer);
        });        

        test('should notify all contexts', () => {
            
            const onlineStatusChanged1 = jest.fn();
            const onlineStatusChanged2 = jest.fn();
            service.start('context1', onlineStatusChanged1);
            service.start('context2', onlineStatusChanged2);

            service.setOnline(true);

            expect(onlineStatusChanged1).toHaveBeenCalledTimes(1);
            expect(onlineStatusChanged2).toHaveBeenCalledTimes(1);

        });        

        
    })

    describe('stop', () => {
        let service: OnlineStateMonitoringService;
        let s
        beforeEach(() => {
            s = service = useOnlineStatusMonitoring();
        });
    
        afterEach( () => {
            s.reset()
        })

        test('should stop listening to online status changes for a context', () => {
            const context = 'test-context';
            const onlineStatusChanged = jest.fn();


            service.start(context, onlineStatusChanged);
            service.setOnline(true);        
            service.stop(context);       
        
            service.setOnline(true);
            service.setOnline(true);
            expect(onlineStatusChanged).toHaveBeenCalledTimes(1)
          });
        
          test('should not throw an error if context is not started', () => {
            const context = 'test-context';
            expect(() => service.stop(context)).not.toThrow();
          });
        

    })
});