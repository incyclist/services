const {EventLogger,ConsoleAdapter} = require( 'gd-eventlog');
const {AntDevice} = require('incyclist-ant-plus/lib/bindings');
const { autoDetect } = require('@serialport/bindings-cpp')
const {useDeviceAccess} = require('incyclist-services');
const { TCPBinding } = require('incyclist-devices');

EventLogger.registerAdapter(new ConsoleAdapter()) 

const parseArgs = ()=> {
    // TODO
    const args = process.argv.slice(2)

    return {command:'scan'}

}


class App {
    props;
    deviceAccess;
    logger;

    constructor(props) {

        this.props = props;
        this.logger= new EventLogger('SampleApp')
        this.deviceAccess = useDeviceAccess()
    }

    async run() {
        const {command='scan'} = this.props

        switch( command) {
            case 'scan':
                await this.scan({timeout:10000});
        }
    
        await this.deviceAccess.disconnect();
    }

    async scan() {
        this.logger.logEvent({message:'scan'})
        
        this.deviceAccess.setDefaultInterfaceProperties({connectTimeout:2000, scanTimeout:5000})
        this.deviceAccess.enableInterface('serial',autodetect(),{protocol:'Daum Classic'})
        this.deviceAccess.enableInterface('tcpip',TCPBinding,{port:51955, protocol:'Daum Premium'})
        this.deviceAccess.enableInterface('ant',AntDevice)
        //this.deviceAccess.enableInterface('ble',BleBinding)

        this.deviceAccess.on('device', (device)=> {this.logger.logEvent({message:'device detected'},device)})
        this.deviceAccess.on('scan-started', ()=> {
            this.logger.logEvent({message:'scan started'})
        })
        this.deviceAccess.on('scan-stopped', ()=> {this.logger.logEvent({message:'scan stopped'})})
        this.deviceAccess.on('interface-state-changed', (ifaceName,state)=> {this.logger.logEvent({message:'interface state',interface:ifaceName,state})})

        try {
            const devices = await this.deviceAccess.scan()
            this.logger.logEvent({message:'devices found',devices})

        }
        catch(err) {
            this.logger.logEvent({message:'error',fn:'scan',error:err.message,stack:err.stack})
        }
       
    }

    exit() {
        process.exit()

    }
}


const args = parseArgs()
const app = new App(args)
process.on('SIGINT', () => app.exit() );  // CTRL+C
process.on('SIGQUIT', () => app.exit() ); // Keyboard quit
process.on('SIGTERM', () => app.exit() ); // `kill` command 

app.run()
    //.then(()=>process.exit(0))
    .catch(()=>process.exit(1))