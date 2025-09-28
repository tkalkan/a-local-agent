const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const os = require('os');

class PrinterTester {
  constructor() {
    this.discoveredPrinters = [];
  }

  async run() {
    console.log('\nHilfeX Printer Test Utility');
    console.log('Android Tablet Printer Testing\n');

    try {
      await this.showMenu();
    } catch (error) {
      console.error('Test failed:', error.message);
      process.exit(1);
    }
  }

  async showMenu() {
    console.log('Select test action:');
    console.log('1. Discover Printers');
    console.log('2. Test Print (Manual IP)');
    console.log('3. Network Scan');
    console.log('4. Connection Test');
    console.log('5. Print Test Receipt');
    console.log('6. Show Network Info');
    console.log('7. Exit');
    
    const choice = await this.promptInput('Enter choice (1-7): ');

    switch (choice) {
      case '1':
        await this.discoverPrinters();
        break;
      case '2':
        await this.manualPrintTest();
        break;
      case '3':
        await this.networkScan();
        break;
      case '4':
        await this.connectionTest();
        break;
      case '5':
        await this.printTestReceipt();
        break;
      case '6':
        await this.showNetworkInfo();
        break;
      case '7':
        console.log('Goodbye!');
        return;
      default:
        console.log('Invalid choice');
    }

    console.log('\n');
    await this.showMenu();
  }

  async discoverPrinters() {
    console.log('Discovering printers...');
    
    this.discoveredPrinters = [];
    
    const discoveries = await Promise.allSettled([
      this.discoverByPortScan(),
      this.discoverByBroadcast(),
      this.discoverCommonAddresses()
    ]);

    discoveries.forEach((result, index) => {
      const methods = ['Port Scan', 'Broadcast', 'Common Addresses'];
      if (result.status === 'fulfilled' && result.value.length > 0) {
        console.log(`✅ ${methods[index]}: Found ${result.value.length} printer(s)`);
        this.discoveredPrinters.push(...result.value);
      } else {
        console.log(`⚠️  ${methods[index]}: No printers found`);
      }
    });

    const uniquePrinters = this.discoveredPrinters.filter((printer, index, self) =>
      index === self.findIndex(p => p.host === printer.host && p.port === printer.port)
    );

    if (uniquePrinters.length > 0) {
      console.log(`\n✅ Total found: ${uniquePrinters.length} unique printer(s)`);
      uniquePrinters.forEach((printer, index) => {
        console.log(`${index + 1}. ${printer.name} - ${printer.host}:${printer.port} (${printer.type})`);
      });
      
      this.discoveredPrinters = uniquePrinters;
    } else {
      console.log('\n❌ No printers discovered');
      console.log('💡 Try:');
      console.log('   • Check if printer is on and connected to network');
      console.log('   • Verify network connectivity');
      console.log('   • Use manual IP test');
    }
  }

  async discoverByPortScan() {
    const subnet = this.getLocalIP().split('.').slice(0, 3).join('.');
    const commonPorts = [9100, 9101, 9102, 8080, 8008, 631];
    const printers = [];

    console.log(`Scanning subnet ${subnet}.x for printers...`);
    
    const scanPromises = [];
    for (let i = 1; i <= 50; i++) {
      const host = `${subnet}.${i}`;
      for (const port of commonPorts) {
        scanPromises.push(this.testTCPConnection(host, port, 500));
      }
    }

    const results = await Promise.allSettled(scanPromises);
    results.forEach(result => {
      if (result.status === 'fulfilled' && result.value) {
        printers.push({
          ...result.value,
          type: 'port_scan'
        });
      }
    });

    return printers;
  }

  async discoverByBroadcast() {
    console.log('Broadcasting discovery packets...');
    
    return new Promise((resolve) => {
      const client = dgram.createSocket('udp4');
      const printers = [];
      
      client.bind(() => {
        client.setBroadcast(true);
        
        const messages = [
          Buffer.from('HILFEX_PRINTER_DISCOVERY'),
          Buffer.from('ESC_POS_DISCOVERY'),
          Buffer.from('PRINTER_DISCOVERY')
        ];
        
        messages.forEach(msg => {
          client.send(msg, 0, msg.length, 8255, '255.255.255.255');
          client.send(msg, 0, msg.length, 9100, '255.255.255.255');
        });
        
        setTimeout(() => {
          client.close();
          resolve(printers);
        }, 3000);
      });
      
      client.on('message', (msg, rinfo) => {
        try {
          const response = JSON.parse(msg.toString());
          if (response.type === 'printer') {
            printers.push({
              host: rinfo.address,
              port: response.port || 9100,
              name: response.name || `Printer-${rinfo.address}`,
              type: 'broadcast'
            });
          }
        } catch (error) {
          const msgStr = msg.toString().trim();
          if (msgStr.includes('PRINTER') || msgStr.includes('ESC')) {
            printers.push({
              host: rinfo.address,
              port: 9100,
              name: `Printer-${rinfo.address}`,
              type: 'broadcast_simple'
            });
          }
        }
      });
      
      client.on('error', () => {
        client.close();
        resolve([]);
      });
    });
  }

  async discoverCommonAddresses() {
    console.log('Testing common printer addresses...');
    
    const commonAddresses = [
      '192.168.1.100:9100',
      '192.168.1.200:9100',
      '192.168.0.100:9100',
      '192.168.178.54:9100',
      '192.168.4.1:9100',
      '10.0.0.1:9100',
      '172.16.1.1:9100'
    ];

    const printers = [];
    for (const address of commonAddresses) {
      const [host, port] = address.split(':');
      const result = await this.testTCPConnection(host, parseInt(port), 2000);
      if (result) {
        printers.push({
          ...result,
          type: 'common'
        });
      }
    }

    return printers;
  }

  async testTCPConnection(host, port, timeout = 1000) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const timer = setTimeout(() => {
        socket.destroy();
        resolve(null);
      }, timeout);

      socket.connect(port, host, () => {
        clearTimeout(timer);
        socket.destroy();
        resolve({
          host,
          port,
          name: `Printer-${host}:${port}`,
          status: 'connected'
        });
      });

      socket.on('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
    });
  }

  async manualPrintTest() {
    const host = await this.promptInput('Enter printer IP address [192.168.1.100]: ') || '192.168.1.100';
    const port = parseInt(await this.promptInput('Enter printer port [9100]: ') || '9100');
    
    console.log(`Testing connection to ${host}:${port}...`);
    
    const connectionTest = await this.testTCPConnection(host, port, 5000);
    if (!connectionTest) {
      console.log('❌ Connection failed - printer not reachable');
      return;
    }
    
    console.log('✅ Connection successful');
    
    const doPrint = await this.promptConfirm('Send test print?', true);
    if (doPrint) {
      await this.sendTestPrint(host, port);
    }
  }

  async networkScan() {
    console.log('Network Analysis...');
    
    const localIP = this.getLocalIP();
    const subnet = localIP.split('.').slice(0, 3).join('.');
    
    console.log(`Local IP: ${localIP}`);
    console.log(`Subnet: ${subnet}.x`);
    
    console.log('\nScanning active devices...');
    
    const activeHosts = [];
    const scanPromises = [];
    
    for (let i = 1; i < 255; i++) {
      const host = `${subnet}.${i}`;
      scanPromises.push(this.quickPing(host));
    }
    
    const results = await Promise.allSettled(scanPromises);
    results.forEach(result => {
      if (result.status === 'fulfilled' && result.value) {
        activeHosts.push(result.value);
      }
    });
    
    console.log(`\n✅ Found ${activeHosts.length} active devices:`);
    activeHosts.forEach((host, index) => {
      console.log(`${index + 1}. ${host}`);
    });
    
    if (activeHosts.length > 0) {
      console.log('\nTesting printer ports on active devices...');
      
      const printerPorts = [9100, 9101, 9102, 631, 8080];
      const printers = [];
      
      for (const host of activeHosts.slice(0, 10)) {
        for (const port of printerPorts) {
          const result = await this.testTCPConnection(host, port, 1000);
          if (result) {
            printers.push(result);
          }
        }
      }
      
      if (printers.length > 0) {
        console.log(`\n🖨️  Potential printers found:`);
        printers.forEach((printer, index) => {
          console.log(`${index + 1}. ${printer.host}:${printer.port}`);
        });
      } else {
        console.log('\n⚠️  No printer ports found on active devices');
      }
    }
  }

  async quickPing(host) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const timer = setTimeout(() => {
        socket.destroy();
        resolve(null);
      }, 200);

      socket.connect(80, host, () => {
        clearTimeout(timer);
        socket.destroy();
        resolve(host);
      });

      socket.on('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
    });
  }

  async connectionTest() {
    if (this.discoveredPrinters.length === 0) {
      console.log('⚠️  No discovered printers. Running discovery first...');
      await this.discoverPrinters();
      
      if (this.discoveredPrinters.length === 0) {
        return;
      }
    }

    console.log('Select printer to test:');
    this.discoveredPrinters.forEach((printer, index) => {
      console.log(`${index + 1}. ${printer.name} - ${printer.host}:${printer.port}`);
    });

    const choice = await this.promptInput('Enter printer number: ');
    const printerIndex = parseInt(choice) - 1;

    if (printerIndex < 0 || printerIndex >= this.discoveredPrinters.length) {
      console.log('Invalid selection');
      return;
    }

    const printer = this.discoveredPrinters[printerIndex];
    console.log(`Testing detailed connection to ${printer.host}:${printer.port}...`);
    
    const tests = [
      { name: 'Basic TCP', test: () => this.testTCPConnection(printer.host, printer.port, 3000) },
      { name: 'Extended Connection', test: () => this.testExtendedConnection(printer.host, printer.port) },
      { name: 'Data Send Test', test: () => this.testDataSend(printer.host, printer.port) }
    ];

    for (const test of tests) {
      console.log(`Running ${test.name}...`);
      
      try {
        const result = await test.test();
        if (result) {
          console.log(`✅ ${test.name}: SUCCESS`);
        } else {
          console.log(`❌ ${test.name}: FAILED`);
        }
      } catch (error) {
        console.log(`❌ ${test.name}: ERROR - ${error.message}`);
      }
    }
  }

  async testExtendedConnection(host, port) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let connected = false;
      
      const timer = setTimeout(() => {
        if (!connected) {
          socket.destroy();
          resolve(false);
        }
      }, 5000);

      socket.connect(port, host, () => {
        connected = true;
        console.log(`    Connected to ${host}:${port}`);
        
        setTimeout(() => {
          clearTimeout(timer);
          socket.end();
          resolve(true);
        }, 1000);
      });

      socket.on('data', (data) => {
        console.log(`    Received data: ${data.length} bytes`);
      });

      socket.on('error', (error) => {
        clearTimeout(timer);
        console.log(`    Connection error: ${error.message}`);
        resolve(false);
      });

      socket.on('close', () => {
        if (connected) {
          console.log(`    Connection closed gracefully`);
        }
      });
    });
  }

  async testDataSend(host, port) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      
      const timer = setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, 5000);

      socket.connect(port, host, () => {
        clearTimeout(timer);
        
        const testData = '\x1B@\x1Bt\x12Test\x0A\x0A\x0A';
        socket.write(testData, 'binary');
        
        setTimeout(() => {
          socket.end();
          resolve(true);
        }, 500);
      });

      socket.on('error', (error) => {
        clearTimeout(timer);
        resolve(false);
      });
    });
  }

  async printTestReceipt() {
    let printer;
    
    if (this.discoveredPrinters.length > 0) {
      console.log('Select printer:');
      this.discoveredPrinters.forEach((p, index) => {
        console.log(`${index + 1}. ${p.name} - ${p.host}:${p.port}`);
      });
      console.log(`${this.discoveredPrinters.length + 1}. Manual IP Entry`);

      const choice = await this.promptInput('Enter choice: ');
      const index = parseInt(choice) - 1;

      if (index >= 0 && index < this.discoveredPrinters.length) {
        printer = this.discoveredPrinters[index];
      }
    }

    if (!printer) {
      const host = await this.promptInput('Printer IP [192.168.1.100]: ') || '192.168.1.100';
      const port = parseInt(await this.promptInput('Printer port [9100]: ') || '9100');
      
      printer = { host, port, name: `Manual-${host}` };
    }

    await this.sendTestPrint(printer.host, printer.port);
  }

  async sendTestPrint(host, port) {
    console.log(`Sending test receipt to ${host}:${port}...`);
    
    const testReceipt = this.createTestReceipt();
    const escPosData = this.convertToESCPOS(testReceipt);
    
    try {
      const result = await this.sendRawData(host, port, escPosData);
      if (result) {
        console.log('✅ Test receipt sent successfully!');
        console.log('Check your printer for output');
      } else {
        console.log('❌ Failed to send test receipt');
      }
    } catch (error) {
      console.log(`❌ Print error: ${error.message}`);
    }
  }

  async sendRawData(host, port, data) {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('Connection timeout'));
      }, 10000);

      socket.connect(port, host, () => {
        clearTimeout(timer);
        console.log('    Connected, sending data...');
        
        socket.write(data, 'binary');
        socket.end();
        
        setTimeout(() => {
          resolve(true);
        }, 1000);
      });

      socket.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  createTestReceipt() {
    const currentTime = new Date();
    const localIP = this.getLocalIP();
    
    return `
================================
     ISTANBUL RESTAURANT
         Stuttgart
================================
🧪 ANDROID TEST YAZDIRMA
Tarih: ${currentTime.toLocaleDateString('tr-TR')}
Saat: ${currentTime.toLocaleTimeString('tr-TR')}
================================
Test Cihazı: Lenovo Tablet
Android IP: ${localIP}
Agent Port: 3001

Türkçe Karakter Testi:
çığöşüÇIĞÖŞÜ ğĞıİöÖşŞüÜç

================================
HilfeX Digital Menu System
Android Local Print Agent v2.0
Termux Compatible
================================
Test başarıyla tamamlandı! ✅

Bu fiş Android tabletten
yazdırılmıştır.

Teşekkürler!
================================


`;
  }

  convertToESCPOS(text) {
    const ESC = '\x1B';
    const GS = '\x1D';
    
    let commands = '';
    
    commands += ESC + '@';
    commands += ESC + 't\x12';
    commands += ESC + 'R\x12';
    
    const turkishMap = {
      'ç': '\x87', 'Ç': '\x80',
      'ğ': '\x83', 'Ğ': '\xA6',
      'ı': '\x8D', 'İ': '\x98',
      'ö': '\x94', 'Ö': '\x99',
      'ş': '\x9F', 'Ş': '\x9E',
      'ü': '\x81', 'Ü': '\x9A'
    };
    
    let processedText = text;
    for (const [turkish, encoded] of Object.entries(turkishMap)) {
      processedText = processedText.replace(new RegExp(turkish, 'g'), encoded);
    }
    
    const lines = processedText.split('\n');
    
    for (let line of lines) {
      if (line.includes('ISTANBUL RESTAURANT')) {
        commands += ESC + 'a\x01';
        commands += ESC + 'E\x01';
        commands += GS + '!\x11';
        commands += line + '\n';
        commands += ESC + 'E\x00';
        commands += GS + '!\x00';
      } else if (line.includes('🧪 ANDROID TEST')) {
        commands += ESC + 'a\x01';
        commands += ESC + 'E\x01';
        commands += line + '\n';
        commands += ESC + 'E\x00';
      } else if (line.includes('===')) {
        commands += ESC + 'a\x01';
        commands += line + '\n';
        commands += ESC + 'a\x00';
      } else {
        commands += line + '\n';
      }
    }
    
    commands += GS + 'V\x00';
    
    return commands;
  }

  async showNetworkInfo() {
    console.log('Network Information\n');
    
    const networkInterfaces = os.networkInterfaces();
    
    console.log('System Info:');
    console.log(`Platform: ${os.platform()} ${os.arch()}`);
    console.log(`Hostname: ${os.hostname()}`);
    console.log(`Node.js: ${process.version}`);
    
    const isTermux = process.env.PREFIX && process.env.PREFIX.includes('com.termux');
    console.log(`Termux: ${isTermux ? 'Yes' : 'No'}`);
    
    console.log('\nNetwork Interfaces:');
    for (const [name, interfaces] of Object.entries(networkInterfaces)) {
      console.log(`${name}:`);
      interfaces.forEach(iface => {
        if (!iface.internal) {
          console.log(`  ${iface.family}: ${iface.address}/${iface.netmask}`);
        }
      });
    }
    
    console.log('\nPrimary IP Address:');
    console.log(`${this.getLocalIP()}`);
    
    console.log('\nTesting internet connectivity...');
    try {
      const fetch = require('node-fetch');
      const response = await fetch('http://google.com', { timeout: 5000 });
      console.log('✅ Internet connection: OK');
    } catch (error) {
      console.log('❌ Internet connection: Failed');
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

  async promptInput(question) {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  async promptConfirm(question, defaultValue) {
    const defaultText = defaultValue ? 'Y/n' : 'y/N';
    const answer = await this.promptInput(`${question} [${defaultText}]: `);
    
    if (answer === '') {
      return defaultValue;
    }
    
    return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
  }
}

if (require.main === module) {
  const tester = new PrinterTester();
  tester.run().catch(error => {
    console.error('\nTest failed:', error);
    process.exit(1);
  });
}

module.exports = PrinterTester;