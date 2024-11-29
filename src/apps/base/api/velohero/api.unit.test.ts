import { AxiosError, AxiosResponse } from 'axios';
import {VeloHeroApi} from './api';
import exp from 'constants';


describe('VeloHeroApi', () => {
    let api:VeloHeroApi;

    let form
    let settings;
    let restClient

    const mockDependencies = (api) => {
        settings = {
            get: jest.fn(() => 'https://app.velohero.com')
        }
        form = {
            post: jest.fn(),
            createForm: jest.fn()
        }
        restClient = jest.fn(() => ({
            request: jest.fn()
        }))

        api.getUserSettings= jest.fn(() => settings)
        api.getFormBinding = jest.fn(() => form)
        api.getApi= jest.fn(() => restClient)

    }

    const mockLoginResponse = (api,data) => {
        api.loginResponse = data        
    }

    beforeEach(() => {
        api = new VeloHeroApi();
        mockDependencies(api)
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('login', () => {
        test('positive login pro account', async () => {
            // Mock the get() method to return a successful response
            restClient.request = jest.fn().mockResolvedValue({ status: 200, data: { 'user-id': 123, session: 'session123', 'user-pro': true } });

            const response = await api.login('username', 'password');

            expect(response).toEqual({
                username: 'username',
                id: 123,
                session: 'session123',
                isPro: true
            });

            expect(api.isAuthenticated()).toBe(true)
            expect(api.getAccountType()).toBe('Pro')
        });

        test('positive login free account', async () => {
            // Mock the get() method to return a successful response
            restClient.request = jest.fn().mockResolvedValue({ status: 200, data: { 'user-id': 123, session: 'session123', 'user-pro': true } });

            restClient.request = jest.fn().mockResolvedValue({ status: 200, data: { 'user-id': 123, session: 'session123', 'user-pro': false } });
            await api.login('username', 'password');

            expect(api.isAuthenticated()).toBe(true)
            expect(api.getAccountType()).toBe('Free')
        });

        test('invalid credentials', async () => {
            // Mock the get() method to return a 403 status code
            restClient.request = jest.fn().mockResolvedValue({ status: 403 });

            await expect(api.login('username', 'password')).rejects.toThrow('invalid credentials');
            expect(api.isAuthenticated()).toBe(false)
        });

        test('server error', async () => {
            // Mock the get() method to return a 403 status code
            const response = {data:undefined,status:503, statusText:'YYY',headers:{}, config:undefined} as unknown as AxiosResponse
            restClient.request = jest.fn().mockRejectedValue( new AxiosError('XXX',"503",undefined, undefined, response ))

            await expect(api.login('username', 'password')).rejects.toThrow('HTTP error 503: YYY');
            expect(api.isAuthenticated()).toBe(false)
        });

    });

    describe('upload', () => {
        test('successfull upload with credentials', async () => {
            mockLoginResponse(api,{ username: 'testUser', id: 123, session: 'session123', isPro: true });
            const mockData = {id:'123','url-show': './show/123', 'url-edit': './edit/123'}
            form.createForm.mockResolvedValue(mockData);
            form.post = jest.fn( (data)=>({ data, error: null }));

            const result = await api.upload('example.csv',{username:'testUser',password:'testPassword'});

            expect(result).toMatchObject( mockData);

            expect(form.createForm).toHaveBeenCalledWith({url: 'https://app.velohero.com/upload/file'}, {                
                file: { type: 'file', fileName: 'example.csv' },
                user: 'testUser',
                pass: 'testPassword',
                view: 'json'
            });           
        });

        test('successfull upload after login', async () => {
            restClient.request = jest.fn().mockResolvedValue({ status: 200, data: { 'user-id': 123, session: 'session123', 'user-pro': true } });

            await api.login('username', 'password');
           

            const mockData = {id:'123','url-show': './show/123', 'url-edit': './edit/123'}
            form.createForm.mockResolvedValue(mockData);
            form.post = jest.fn( async (data)=>({ data, error: null }));

            const result = await api.upload('example.csv');

            expect(result).toEqual(mockData);

            expect(form.createForm).toHaveBeenCalledWith({url: 'https://app.velohero.com/upload/file'}, {                
                file: { type: 'file', fileName: 'example.csv' },
                user: 'username',
                pass: 'password',
                view: 'json'
            });
            
        });


        test('error response', async () => {
            mockLoginResponse(api,{ username: 'testUser', id: 123, session: 'session123', isPro: true });
            form.createForm.mockResolvedValue({});
            form.post.mockResolvedValue( { data:undefined, error: new Error('XXX') });

            await expect( 
                async () => {await api.upload('example.csv',{username:'testUser',password:'testPassword'})
            }).rejects.toThrow('XXX')
            
        });

        test('any other error', async () => {
            mockLoginResponse(api,{ username: 'testUser', id: 123, session: 'session123', isPro: true });
            form.createForm.mockResolvedValue({});
            form.post.mockRejectedValue( new Error('YYY') );

            await expect( 
                async () => {await api.upload('example.csv',{username:'testUser',password:'testPassword'})
            }).rejects.toThrow('YYY')
            
        });



        test('not authenticated', async () => {
            mockLoginResponse(api,undefined);

            await expect(async ()=>  {await api.upload('example.csv')}).rejects.toThrow('not authenticated');
            expect(form.createForm).not.toHaveBeenCalled();
            
        });
    });

    describe('getAccountType',()=>{
        test('not authenticated', async () => {
            
            mockLoginResponse(api,undefined);
            expect( ()=>{api.getAccountType()}).toThrow('not authenticated');

            
            
        });

    })

});
