# HilfeX Android Print Agent v2.0

**Lenovo Tablet Compatible Local Print Agent**

## 🚀 Quick Start

### Prerequisites
- Lenovo Android tablet
- Termux app (from F-Droid)
- Network connection

### Installation
```bash
# Run auto-installer
./install-termux.sh

# Install dependencies
npm install

# Interactive setup
node setup.js

# Test printer
node test-printer.js

# Start agent
./start-agent.sh
```

## 📡 API Endpoints

### HTTP API
- `GET /health` - Health check
- `GET /api/discover-printers` - Find printers
- `POST /api/print` - Send print job
- `POST /api/test-print` - Test print
- `GET /api/network` - Network info

### WebSocket (Port 3002)
- Connect: `ws://TABLET_IP:3002`
- Messages: `print`, `discover`, `ping`

## 🖨️ Supported Protocols

1. **RAW TCP** - Direct thermal printer communication
2. **WebSocket** - Real-time printer communication  
3. **HTTP** - RESTful printer API

## 🔧 Configuration

Edit `config.json`:
```json
{
  "port": 3001,
  "wsPort": 3002,
  "serverUrl": "http://SERVER_IP:5000",
  "printers": [...],
  "protocols": {...}
}
```

## 🧪 Testing

```bash
# Full printer test suite
node test-printer.js

# Quick connection test
curl http://localhost:3001/health

# Discovery test
curl http://localhost:3001/api/discover-printers
```

## 🚨 Troubleshooting

### Common Issues
1. **Connection Failed**: Check printer IP and network
2. **Turkish Chars**: Agent uses CP857 encoding
3. **Service Stops**: Enable background processing
4. **Port Conflicts**: Change ports in config.json

### Logs
```bash
# View logs
tail -f logs/agent.log

# Debug mode
NODE_ENV=development node agent.js
```

## 📱 Lenovo Optimizations

- Battery optimization disabled for Termux
- Wake lock for continuous operation
- Auto-start on boot capability
- Turkish character support optimized

## 🔗 Integration

### Restaurant System Integration
```javascript
// Send to agent from main system
fetch('http://TABLET_IP:3001/api/print', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    data: receiptText,
    printer: { host: 'PRINTER_IP', port: 9100 },
    protocol: 'raw',
    format: 'escpos'
  })
});
```

## 📞 Support

- Full documentation: `ANDROID-SETUP-GUIDE.md`
- Test utilities: `node test-printer.js`
- Interactive setup: `node setup.js`

---
**HilfeX Digital Menu System - Android Print Agent v2.0**