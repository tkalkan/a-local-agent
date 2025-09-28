const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');

class AndroidSetup {
  constructor() {
    this.config = {
      port: 3001,
      wsPort: 3002,
      serverUrl: '',
      printers: [],
      autoStart: true,
      debugMode: false
    };
  }

  async run() {
    console.log('\nHilfeX Android Print Agent Setup');
    console.log('Lenovo Tablet Configuration\n');

    try {
      await this.checkEnvironment();
      await this.collectConfiguration();
      await this.testConnectivity();
      await this.setupSystemService();
      await this.finalizeSetup();
    } catch (error) {
      console.error('Setup failed:', error.message);
      process.exit(1);
    }
  }

  async checkEnvironment() {
    console.log('Checking environment...');
    
    const nodeVersion = process.version;
    console.log(`✅ Node.js ${nodeVersion}`);
    
    const isTermux = process.env.PREFIX && process.env.PREFIX.includes('com.termux');
    if (isTermux) {
      console.log('✅ Running on Termux');
    } else {
      console.log('⚠️  Not detected as Termux environment');
    }
    
    console.log(`✅ Platform: ${os.platform()} ${os.arch()}`);
    
    const localIP = this.getLocalIP();
    console.log(`✅ Local IP: ${localIP}`);
    
    const requiredCommands = ['node', 'npm'];
    for (const cmd of requiredCommands) {
      try {
        if (this.commandExists(cmd)) {
          console.log(`✅ ${cmd} is available`);
        } else {
          throw new Error(`Required command not found: ${cmd}`);
        }
      } catch (error) {
        throw new Error(`Required command not found: ${cmd}`);
      }
    }
    
    console.log('✅ Environment check completed\n');
  }

  commandExists(command) {
    try {
      if (os.platform() === 'win32') {
        execSync(`where ${command}`, { stdio: 'ignore' });
      } else {
        execSync(`which ${command}`, { stdio: 'ignore' });
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  async collectConfiguration() {
    console.log('Configuration Setup\n');
    
    this.config.serverUrl = this.promptInput('Enter the main restaurant server URL:', 'http://192.168.1.100:5000');
    this.config.port = parseInt(this.promptInput('Enter the agent HTTP port:', '3001'));
    this.config.wsPort = parseInt(this.promptInput('Enter the WebSocket port:', '3002'));
    this.config.autoStart = this.promptConfirm('Auto-start agent on boot?', true);
    this.config.debugMode = this.promptConfirm('Enable debug mode?', false);
    
    console.log('✅ Configuration collected\n');
  }

  promptInput(question, defaultValue) {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      rl.question(`${question} [${defaultValue}]: `, (answer) => {
        rl.close();
        resolve(answer.trim() || defaultValue);
      });
    });
  }

  promptConfirm(question, defaultValue) {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      const defaultText = defaultValue ? 'Y/n' : 'y/N';
      rl.question(`${question} [${defaultText}]: `, (answer) => {
        rl.close();
        const response = answer.trim().toLowerCase();
        if (response === '') {
          resolve(defaultValue);
        } else {
          resolve(response === 'y' || response === 'yes');
        }
      });
    });
  }

  async testConnectivity() {
    console.log('Testing connectivity...');
    
    try {
      const fetch = require('node-fetch');
      console.log(`Connecting to ${this.config.serverUrl}...`);
      
      const response = await fetch(`${this.config.serverUrl}/health`, { 
        timeout: 10000 
      });
      
      if (response.ok) {
        console.log('✅ Server connection successful');
      } else {
        console.log('⚠️  Server responded but may not be ready');
      }
    } catch (error) {
      console.log(`⚠️  Server connection failed: ${error.message}`);
      console.log('   You can continue setup and configure server later');
    }

    for (const port of [this.config.port, this.config.wsPort]) {
      try {
        await this.testPort(port);
        console.log(`✅ Port ${port} is available`);
      } catch (error) {
        throw new Error(`Port ${port} is already in use`);
      }
    }
    
    console.log('✅ Connectivity tests completed\n');
  }

  async testPort(port) {
    const net = require('net');
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      
      server.listen(port, (err) => {
        server.close();
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
      
      server.on('error', (err) => {
        reject(err);
      });
    });
  }

  async setupSystemService() {
    console.log('Setting up system service...');
    
    const serviceConfig = {
      name: 'hilfex-print-agent',
      description: 'HilfeX Android Print Agent Service',
      exec: `node ${path.join(__dirname, 'agent.js')}`,
      cwd: __dirname,
      autoRestart: true,
      maxRestarts: 10,
      env: {
        NODE_ENV: 'production',
        PORT: this.config.port,
        WS_PORT: this.config.wsPort,
        SERVER_URL: this.config.serverUrl
      }
    };

    fs.writeFileSync(
      path.join(__dirname, 'service.json'),
      JSON.stringify(serviceConfig, null, 2)
    );
    console.log('✅ Service configuration created');

    if (this.config.autoStart) {
      await this.createStartupScript();
    }
    
    console.log('✅ System service setup completed\n');
  }

  async createStartupScript() {
    const startupScript = `#!/data/data/com.termux/files/usr/bin/bash
cd "${__dirname}"
export NODE_ENV=production
export PORT=${this.config.port}
export WS_PORT=${this.config.wsPort}
export SERVER_URL="${this.config.serverUrl}"

echo "Starting HilfeX Print Agent..."
node agent.js >> logs/agent.log 2>&1 &
echo $! > agent.pid
echo "Agent started with PID: $(cat agent.pid)"

# Auto-launch management interface
sleep 5
if command -v am >/dev/null 2>&1; then
    echo "Launching management interface..."
    am start -a android.intent.action.VIEW -d "https://digitalmenu.hilfex.com/management" >/dev/null 2>&1 || echo "Failed to launch browser"
fi
`;

    const stopScript = `#!/data/data/com.termux/files/usr/bin/bash
cd "${__dirname}"

if [ -f "agent.pid" ]; then
    PID=$(cat agent.pid)
    if kill -0 $PID 2>/dev/null; then
        echo "Stopping HilfeX Print Agent (PID: $PID)..."
        kill $PID
        rm agent.pid
        echo "Agent stopped"
    else
        echo "Agent not running"
        rm -f agent.pid
    fi
else
    echo "No PID file found"
fi
`;

    const autoRestartScript = `#!/data/data/com.termux/files/usr/bin/bash
cd "${__dirname}"

while true; do
    if [ ! -f "agent.pid" ] || ! kill -0 $(cat agent.pid) 2>/dev/null; then
        echo "Agent not running, restarting..."
        ./start-agent.sh
    fi
    sleep 30
done
`;

    fs.writeFileSync(path.join(__dirname, 'start-agent.sh'), startupScript);
    fs.writeFileSync(path.join(__dirname, 'stop-agent.sh'), stopScript);
    fs.writeFileSync(path.join(__dirname, 'auto-restart.sh'), autoRestartScript);
    
    try {
      execSync('chmod +x start-agent.sh stop-agent.sh auto-restart.sh', { cwd: __dirname });
    } catch (error) {
      console.log('⚠️  Could not set script permissions');
    }

    this.createTermuxBootScript();

    console.log('✅ Startup scripts created');
  }

  createTermuxBootScript() {
    const termuxBootDir = path.join(os.homedir(), '.termux', 'boot');
    
    try {
      if (!fs.existsSync(termuxBootDir)) {
        fs.mkdirSync(termuxBootDir, { recursive: true });
      }

      const bootScript = `#!/data/data/com.termux/files/usr/bin/bash
# HilfeX Print Agent Auto-start
sleep 10

cd "${__dirname}"
./start-agent.sh

# Launch management interface in fullscreen
sleep 5
if command -v am >/dev/null 2>&1; then
    am start -a android.intent.action.VIEW -d "https://digitalmenu.hilfex.com/management" -f 0x10000000 >/dev/null 2>&1
fi

# Start auto-restart monitor
./auto-restart.sh &
`;

      const bootScriptPath = path.join(termuxBootDir, 'hilfex-agent');
      fs.writeFileSync(bootScriptPath, bootScript);
      
      try {
        execSync(`chmod +x "${bootScriptPath}"`);
        console.log('✅ Termux boot script created');
      } catch (error) {
        console.log('⚠️  Could not set boot script permissions');
      }
    } catch (error) {
      console.log('⚠️  Could not create boot script');
    }
  }

  async finalizeSetup() {
    console.log('Finalizing setup...');
    
    fs.writeFileSync(
      path.join(__dirname, 'config.json'),
      JSON.stringify(this.config, null, 2)
    );
    console.log('✅ Configuration saved');

    try {
      if (!fs.existsSync(path.join(__dirname, 'logs'))) {
        fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true });
      }
      console.log('✅ Logs directory created');
    } catch (error) {
      // Directory might already exist
    }

    try {
      console.log('Installing dependencies...');
      execSync('npm install', { cwd: __dirname, stdio: 'inherit' });
      console.log('✅ Dependencies installed');
    } catch (error) {
      console.log('⚠️  Dependency installation failed, please run: npm install');
    }

    console.log('\n🎉 Setup completed successfully!');
    console.log('\n📋 Next steps:');
    console.log('1. Test the agent: node test-printer.js');
    console.log('2. Start the agent: ./start-agent.sh');
    console.log('3. Check status: curl http://localhost:' + this.config.port + '/health');
    
    console.log('\n🔗 Access URLs:');
    console.log(`HTTP API: http://${this.getLocalIP()}:${this.config.port}`);
    console.log(`WebSocket: ws://${this.getLocalIP()}:${this.config.wsPort}`);
    
    if (this.config.autoStart) {
      console.log('\n🚀 Auto-start enabled:');
      console.log('Agent will start automatically on system boot');
      console.log('Management interface will open in fullscreen');
    }
  }

  getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return '127.0.0.1';
  }
}

if (require.main === module) {
  const setup = new AndroidSetup();
  setup.run().catch(error => {
    console.error('\nSetup failed:', error);
    process.exit(1);
  });
}

module.exports = AndroidSetup;