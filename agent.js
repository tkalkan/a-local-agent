const express = require('express');
const WebSocket = require('ws');
const net = require('net');
const dgram = require('dgram');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG = {
  port: 3001,
  wsPort: 3002,
  serverUrl: process.env.SERVER_URL || 'http://localhost:5000',
  defaultPrinterHost: process.env.PRINTER_ADDRESS || '192.168.2.38:9100',
  printerDiscoveryTimeout: 5000,
  maxRetries: 3,
  retryDelay: 2000,
  healthCheckInterval: 30000
};

let connectedPrinters = new Map();
let serverConnection = null;
let healthCheckTimer = null;
let restartCount = 0;
const MAX_RESTART_ATTEMPTS = 100;

class AndroidPrintAgent {
  constructor() {
    this.app = express();
    this.server = null;
    this.wsServer = null;
    this.setupExpress();
    this.setupWebSocket();
    this.loadConfiguration();
    this.setupRestartHandler();
  }

  setupExpress() {
    this.app.use(cors({
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      credentials: true
    }));
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    
    this.app.use((req, res, next) => {
      const currentTime = new Date();
      console.log(`[${currentTime.toISOString()}] ${req.method} ${req.url}`);
      next();
    });

    this.setupRoutes();
  }

  setupRoutes() {
    this.app.get('/health', (req, res) => {
      const currentTime = new Date();
      const status = {
        status: 'healthy',
        timestamp: currentTime.toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        connectedPrinters: Array.from(connectedPrinters.keys()),
        serverConnection: serverConnection ? 'connected' : 'disconnected',
        restartCount: restartCount
      };
      res.json(status);
    });

    this.app.get('/api/discover-printers', async (req, res) => {
      try {
        console.log('Starting printer discovery...');
        const printers = await this.discoverPrinters();
        res.json({ success: true, printers });
      } catch (error) {
        console.error('Printer discovery failed:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/print', async (req, res) => {
      try {
        const { data, printer, protocol = 'raw', format = 'escpos' } = req.body;
        
        if (!data) {
          return res.status(400).json({ success: false, error: 'Print data is required' });
        }

        console.log(`Print request: ${protocol}/${format} to ${printer?.name || 'default'}`);
        
        const result = await this.printWithProtocol(data, printer, protocol, format);
        res.json(result);
      } catch (error) {
        console.error('Print failed:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/test-print', async (req, res) => {
      try {
        const { printer } = req.body;
        const testData = this.generateTestReceipt();
        
        const result = await this.printWithProtocol(testData, printer, 'raw', 'escpos');
        res.json(result);
      } catch (error) {
        console.error('Test print failed:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/config', (req, res) => {
      res.json(CONFIG);
    });

    this.app.post('/api/config', async (req, res) => {
      try {
        Object.assign(CONFIG, req.body);
        await this.saveConfiguration();
        res.json({ success: true, config: CONFIG });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/network', (req, res) => {
      const networkInterfaces = os.networkInterfaces();
      const activeInterfaces = {};
      
      for (const [name, interfaces] of Object.entries(networkInterfaces)) {
        activeInterfaces[name] = interfaces
          .filter(iface => !iface.internal && iface.family === 'IPv4')
          .map(iface => ({
            address: iface.address,
            netmask: iface.netmask,
            family: iface.family
          }));
      }

      res.json({
        hostname: os.hostname(),
        platform: os.platform(),
        interfaces: activeInterfaces,
        primaryIP: this.getPrimaryIP()
      });
    });
  }

  setupWebSocket() {
    this.wsServer = new WebSocket.Server({ 
      port: CONFIG.wsPort,
      perMessageDeflate: false,
      maxPayload: 10 * 1024 * 1024
    });

    this.wsServer.on('connection', (ws, req) => {
      console.log(`WebSocket connection from ${req.socket.remoteAddress}`);
      
      ws.on('message', async (message) => {
        try {
          const data = JSON.parse(message.toString());
          await this.handleWebSocketMessage(ws, data);
        } catch (error) {
          console.error('WebSocket message error:', error);
          ws.send(JSON.stringify({ 
            type: 'error', 
            message: error.message 
          }));
        }
      });

      ws.on('close', () => {
        console.log('WebSocket connection closed');
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
      });

      ws.send(JSON.stringify({
        type: 'status',
        data: {
          connected: true,
          printers: Array.from(connectedPrinters.keys())
        }
      }));
    });
  }

  async handleWebSocketMessage(ws, data) {
    const { type, payload } = data;

    switch (type) {
      case 'print':
        const result = await this.printWithProtocol(
          payload.data,
          payload.printer,
          payload.protocol || 'raw',
          payload.format || 'escpos'
        );
        ws.send(JSON.stringify({ type: 'print_result', data: result }));
        break;

      case 'discover':
        const printers = await this.discoverPrinters();
        ws.send(JSON.stringify({ type: 'printers_discovered', data: printers }));
        break;

      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        break;

      default:
        console.warn(`Unknown WebSocket message type: ${type}`);
    }
  }

  async printWithProtocol(data, printer, protocol, format) {
    // Dinamik yazıcı konfigürasyonu - ortam değişkenlerinden al
    let printerConfig;
    if (printer && printer.host) {
      printerConfig = printer;
    } else {
      // Environment'tan yazıcı IP'sini al
      const [host, port] = CONFIG.defaultPrinterHost.split(':');
      printerConfig = {
        host: host || 'localhost',
        port: parseInt(port) || 9100,
        name: 'system-default'
      };
    }

    console.log(`🖨️ Printing via ${protocol}/${format} to ${printerConfig.host}:${printerConfig.port}`);

    switch (protocol.toLowerCase()) {
      case 'websocket':
        return await this.printViaWebSocket(data, printerConfig, format);
      
      case 'raw':
      case 'tcp':
        return await this.printViaRawTCP(data, printerConfig, format);
      
      case 'http':
        return await this.printViaHTTP(data, printerConfig, format);
      
      default:
        throw new Error(`Unsupported protocol: ${protocol}`);
    }
  }

  async printViaRawTCP(data, printer, format) {
    return new Promise((resolve, reject) => {
      const client = new net.Socket();
      const timeout = setTimeout(() => {
        client.destroy();
        reject(new Error('Printer connection timeout'));
      }, CONFIG.printerDiscoveryTimeout);

      let printData = data;
      if (format === 'escpos') {
        printData = this.convertToESCPOS(data);
      }

      client.connect(printer.port || 9100, printer.host, () => {
        clearTimeout(timeout);
        console.log(`Connected to printer ${printer.host}:${printer.port}`);
        
        client.write(printData, 'binary');
        client.end();
        
        resolve({
          success: true,
          method: 'raw_tcp',
          message: `Printed successfully to ${printer.host}:${printer.port}`,
          timestamp: new Date().toISOString()
        });
      });

      client.on('error', (error) => {
        clearTimeout(timeout);
        console.error(`TCP Print error: ${error.message}`);
        reject(new Error(`TCP Print failed: ${error.message}`));
      });

      client.on('close', () => {
        clearTimeout(timeout);
      });
    });
  }

  async printViaWebSocket(data, printer, format) {
    return new Promise((resolve, reject) => {
      const wsUrl = `ws://${printer.host}:${printer.wsPort || 8080}/print`;
      const ws = new WebSocket(wsUrl);

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('WebSocket printer connection timeout'));
      }, CONFIG.printerDiscoveryTimeout);

      ws.on('open', () => {
        clearTimeout(timeout);
        let printData = data;
        if (format === 'escpos') {
          printData = this.convertToESCPOS(data);
        }

        ws.send(JSON.stringify({
          type: 'print',
          data: printData,
          format: format
        }));
      });

      ws.on('message', (message) => {
        const response = JSON.parse(message.toString());
        if (response.success) {
          resolve({
            success: true,
            method: 'websocket',
            message: `WebSocket print successful to ${printer.host}`,
            timestamp: new Date().toISOString()
          });
        } else {
          reject(new Error(response.error || 'WebSocket print failed'));
        }
        ws.close();
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        reject(new Error(`WebSocket print error: ${error.message}`));
      });
    });
  }

  async printViaHTTP(data, printer, format) {
    const fetch = require('node-fetch');
    const url = `http://${printer.host}:${printer.httpPort || 8008}/print`;
    
    let printData = data;
    if (format === 'escpos') {
      printData = this.convertToESCPOS(data);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': Buffer.byteLength(printData)
      },
      body: printData,
      timeout: CONFIG.printerDiscoveryTimeout
    });

    if (!response.ok) {
      throw new Error(`HTTP print failed: ${response.status} ${response.statusText}`);
    }

    return {
      success: true,
      method: 'http',
      message: `HTTP print successful to ${printer.host}`,
      timestamp: new Date().toISOString()
    };
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
      } else if (line.includes('TOPLAM:')) {
        commands += ESC + 'E\x01';
        commands += GS + '!\x10';
        commands += line + '\n';
        commands += ESC + 'E\x00';
        commands += GS + '!\x00';
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

  async discoverPrinters() {
    console.log('Discovering printers on network...');
    
    const discoveries = await Promise.allSettled([
      this.discoverByPortScan(),
      this.discoverByBroadcast(),
      this.discoverByCommonAddresses()
    ]);

    const printers = new Set();
    discoveries.forEach(result => {
      if (result.status === 'fulfilled' && result.value) {
        result.value.forEach(printer => printers.add(JSON.stringify(printer)));
      }
    });

    const uniquePrinters = Array.from(printers).map(p => JSON.parse(p));
    console.log(`Found ${uniquePrinters.length} printer(s)`);
    
    return uniquePrinters;
  }

  async discoverByPortScan() {
    const subnet = this.getPrimaryIP().split('.').slice(0, 3).join('.');
    const commonPorts = [9100, 9101, 9102, 8080, 8008, 631];
    const printers = [];

    const scanPromises = [];
    for (let i = 1; i < 255; i++) {
      const host = `${subnet}.${i}`;
      for (const port of commonPorts) {
        scanPromises.push(this.testConnection(host, port));
      }
    }

    const results = await Promise.allSettled(scanPromises);
    results.forEach(result => {
      if (result.status === 'fulfilled' && result.value) {
        printers.push(result.value);
      }
    });

    return printers;
  }

  async discoverByBroadcast() {
    return new Promise((resolve) => {
      const client = dgram.createSocket('udp4');
      const printers = [];
      
      client.bind(() => {
        client.setBroadcast(true);
        
        const discoveryMsg = Buffer.from('HILFEX_PRINTER_DISCOVERY');
        client.send(discoveryMsg, 0, discoveryMsg.length, 8255, '255.255.255.255');
        
        setTimeout(() => {
          client.close();
          resolve(printers);
        }, 2000);
      });
      
      client.on('message', (msg, rinfo) => {
        try {
          const response = JSON.parse(msg.toString());
          if (response.type === 'printer') {
            printers.push({
              host: rinfo.address,
              port: response.port || 9100,
              name: response.name || `Printer-${rinfo.address}`,
              type: 'discovered'
            });
          }
        } catch (error) {
          // Ignore non-JSON responses
        }
      });
      
      client.on('error', () => {
        client.close();
        resolve([]);
      });
    });
  }

  async discoverByCommonAddresses() {
    const commonAddresses = [
      '192.168.1.100:9100',
      '192.168.1.200:9100',
      '192.168.0.100:9100',
      '192.168.178.54:9100',
      '10.0.0.100:9100'
    ];

    const printers = [];
    for (const address of commonAddresses) {
      const [host, port] = address.split(':');
      const result = await this.testConnection(host, parseInt(port));
      if (result) {
        printers.push(result);
      }
    }

    return printers;
  }

  async testConnection(host, port) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const timer = setTimeout(() => {
        socket.destroy();
        resolve(null);
      }, 1000);

      socket.connect(port, host, () => {
        clearTimeout(timer);
        socket.destroy();
        resolve({
          host,
          port,
          name: `Printer-${host}:${port}`,
          type: 'tcp'
        });
      });

      socket.on('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
    });
  }

  generateTestReceipt() {
    const currentTime = new Date();
    return `
================================
     ISTANBUL RESTAURANT
         Stuttgart
================================
ANDROID TEST YAZDIRMA
Tarih: ${currentTime.toLocaleDateString('tr-TR')}
Saat: ${currentTime.toLocaleTimeString('tr-TR')}
================================
Bu bir Android test yazdirmasidir.
Lenovo tablet başarıyla bağlandı!

Türkçe karakter testi:
çığöşüÇIĞÖŞÜ

HilfeX Digital Menu System
Android Local Print Agent v2.0
================================

`;
  }

  getPrimaryIP() {
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

  async loadConfiguration() {
    try {
      const configPath = path.join(__dirname, 'config.json');
      const configData = fs.readFileSync(configPath, 'utf8');
      Object.assign(CONFIG, JSON.parse(configData));
      console.log('Configuration loaded');
    } catch (error) {
      console.log('Using default configuration');
    }
  }

  async saveConfiguration() {
    try {
      const configPath = path.join(__dirname, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify(CONFIG, null, 2));
      console.log('Configuration saved');
    } catch (error) {
      console.error('Failed to save configuration:', error);
      throw error;
    }
  }

  setupRestartHandler() {
    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error);
      this.handleRestart('uncaught exception');
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
      this.handleRestart('unhandled rejection');
    });
  }

  handleRestart(reason) {
    if (restartCount >= MAX_RESTART_ATTEMPTS) {
      console.error(`Max restart attempts (${MAX_RESTART_ATTEMPTS}) reached. Exiting.`);
      process.exit(1);
    }

    restartCount++;
    console.log(`Restarting agent due to ${reason}. Attempt ${restartCount}/${MAX_RESTART_ATTEMPTS}`);
    
    setTimeout(() => {
      this.stop().then(() => {
        this.start();
      });
    }, CONFIG.retryDelay);
  }

  startHealthCheck() {
    healthCheckTimer = setInterval(async () => {
      try {
        const fetch = require('node-fetch');
        const response = await fetch(`${CONFIG.serverUrl}/health`, { timeout: 5000 });
        serverConnection = response.ok;
      } catch (error) {
        serverConnection = false;
      }
      
      console.log(`Health check: Server ${serverConnection ? 'connected' : 'disconnected'}`);
    }, CONFIG.healthCheckInterval);
  }

  async start() {
    console.log('\nHilfeX Android Print Agent v2.0');
    console.log('Optimized for Lenovo Android Tablets');
    console.log('Termux Compatible\n');

    try {
      this.server = this.app.listen(CONFIG.port, '0.0.0.0', () => {
        console.log(`HTTP Server running on port ${CONFIG.port}`);
        console.log(`WebSocket Server running on port ${CONFIG.wsPort}`);
        console.log(`Local IP: ${this.getPrimaryIP()}`);
        console.log(`Access URL: http://${this.getPrimaryIP()}:${CONFIG.port}`);
      });

      this.startHealthCheck();

      setTimeout(async () => {
        try {
          await this.discoverPrinters();
        } catch (error) {
          console.warn('Initial printer discovery failed');
        }
      }, 2000);

      console.log('\nAgent ready for connections!');
      
    } catch (error) {
      console.error('Failed to start agent:', error);
      this.handleRestart('startup failure');
    }
  }

  async stop() {
    console.log('Shutting down agent...');
    
    if (healthCheckTimer) {
      clearInterval(healthCheckTimer);
    }
    
    if (this.wsServer) {
      this.wsServer.close();
    }
    
    if (this.server) {
      this.server.close();
    }
    
    console.log('Agent stopped successfully');
  }
}

process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT, shutting down gracefully...');
  if (global.agent) {
    await global.agent.stop();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nReceived SIGTERM, shutting down gracefully...');
  if (global.agent) {
    await global.agent.stop();
  }
  process.exit(0);
});

if (require.main === module) {
  global.agent = new AndroidPrintAgent();
  global.agent.start().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = AndroidPrintAgent;