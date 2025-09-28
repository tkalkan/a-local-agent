# HilfeX Android Print Agent - Lenovo Tablet Setup Guide

## 🎯 Overview
This guide provides comprehensive instructions for setting up the HilfeX Android Print Agent on Lenovo tablets using Termux. The agent addresses common compatibility issues and provides multiple printing protocols.

## 📋 Prerequisites

### Android Tablet Requirements
- **Device**: Lenovo Android tablet (Android 7.0+)
- **RAM**: Minimum 2GB (4GB+ recommended)
- **Storage**: 1GB free space
- **Network**: WiFi connection (same network as printer)

### Required Apps
1. **Termux** - Terminal emulator for Android
   - Download from [F-Droid](https://f-droid.org/en/packages/com.termux/)
   - **DO NOT** use Google Play Store version (limited functionality)

2. **Termux:API** (Optional but recommended)
   - Download from [F-Droid](https://f-droid.org/en/packages/com.termux.api/)

## 🚀 Step-by-Step Installation

### Step 1: Install Termux
1. Download Termux from F-Droid (NOT Google Play)
2. Install the APK file
3. Open Termux and wait for initial setup

### Step 2: Grant Permissions
```bash
# Allow storage access
termux-setup-storage

# Grant permission when prompted
```

### Step 3: Run Automatic Installation
```bash
# Download and run the installation script
curl -L https://raw.githubusercontent.com/your-repo/a-local-agent/main/install-termux.sh | bash

# Or manual installation:
wget https://raw.githubusercontent.com/your-repo/a-local-agent/main/install-termux.sh
chmod +x install-termux.sh
./install-termux.sh
```

### Step 4: Copy Agent Files
```bash
# Navigate to agent directory
cd ~/hilfex-print-agent

# Copy your a-local-agent files here
# Required files:
# - agent.js
# - package.json
# - setup.js
# - test-printer.js
# - config-template.json
```

### Step 5: Install Dependencies
```bash
# Install Node.js dependencies
npm install

# If installation fails, try:
npm install --force
```

### Step 6: Run Interactive Setup
```bash
# Run the setup wizard
node setup.js
```

### Step 7: Test Printer Connection
```bash
# Run printer test utility
node test-printer.js
```

### Step 8: Start the Agent
```bash
# Start the agent
./start-agent.sh

# Or manually:
node agent.js
```

## 🔧 Troubleshooting Common Issues

### Issue 1: "Printer Connection Failed"
**Symptoms**: Cannot connect to thermal printer

**Solutions**:
1. **Check Network Connection**
   ```bash
   # Test network connectivity
   ping 192.168.1.1
   
   # Scan for devices
   nmap -sn 192.168.1.0/24
   ```

2. **Verify Printer IP**
   ```bash
   # Test printer connection
   telnet PRINTER_IP 9100
   # Press Ctrl+] then type 'quit' to exit
   ```

3. **Try Different Ports**
   - ESC/POS printers: 9100, 9101, 9102
   - Network printers: 631, 8080, 8008

### Issue 2: "Turkish Characters Not Printing Correctly"
**Solutions**:
1. **Check Printer Codepage Support**
   ```bash
   # Test Turkish character printing
   node test-printer.js
   # Select "Print Test Receipt" option
   ```

2. **Update Character Encoding**
   - Agent uses CP857 (Turkish) codepage
   - Fallback to CP1254 if CP857 not supported
   - Manual character mapping included

### Issue 3: "Node.js Installation Failed"
**Solutions**:
1. **Update Package Repository**
   ```bash
   pkg update
   pkg upgrade
   ```

2. **Install Node.js Manually**
   ```bash
   pkg install nodejs-lts
   pkg install npm
   ```

3. **Check Architecture**
   ```bash
   uname -m
   # Should show: aarch64 or armv7l
   ```

### Issue 4: "Permission Denied Errors"
**Solutions**:
1. **Grant Storage Permissions**
   ```bash
   termux-setup-storage
   ```

2. **Fix Script Permissions**
   ```bash
   chmod +x *.sh
   chmod +x *.js
   ```

### Issue 5: "Agent Stops After Screen Lock"
**Solutions**:
1. **Enable Background Processing**
   - Settings → Apps → Termux → Battery → Optimize battery usage → Don't optimize

2. **Use Wake Lock**
   ```bash
   # Install Termux:API first
   pkg install termux-api
   
   # Use wake lock in startup script
   termux-wake-lock
   ./start-agent.sh
   ```

3. **Create Persistent Service**
   ```bash
   # Add to ~/.bashrc
   echo "cd ~/hilfex-print-agent && ./start-agent.sh" >> ~/.bashrc
   ```

## 🌐 Network Configuration

### Finding Your Printer IP
1. **Router Admin Panel**
   - Access router at 192.168.1.1 or 192.168.0.1
   - Check connected devices

2. **Network Scanner**
   ```bash
   # Install nmap if not available
   pkg install nmap
   
   # Scan network for printers
   nmap -sn 192.168.1.0/24
   nmap -p 9100 192.168.1.0/24
   ```

3. **Printer Settings Menu**
   - Check printer's built-in network settings
   - Print network configuration page

### Subnet Detection
```bash
# Check your tablet's IP
ip addr show

# Common network ranges:
# 192.168.1.x (192.168.1.0/24)
# 192.168.0.x (192.168.0.0/24)  
# 10.0.0.x (10.0.0.0/24)
```

## 📱 Lenovo Tablet Specific Optimizations

### Battery Optimization
1. **Settings → Battery → Battery Optimization**
   - Find Termux → Don't optimize

2. **Auto-start Settings**
   - Settings → Apps → Termux → Permissions → Auto-start → Allow

### Performance Settings
```bash
# Increase Node.js memory limit (if needed)
export NODE_OPTIONS="--max-old-space-size=2048"

# Set CPU affinity (if supported)
taskset 0x1 node agent.js
```

### Display Settings
- Keep screen timeout reasonable (2-5 minutes)
- Enable "Stay awake while charging" in Developer Options

## 🔍 Testing and Verification

### Complete Test Sequence
```bash
# 1. Test network connectivity
node test-printer.js
# Choose: Network Scan

# 2. Discover printers
# Choose: Discover Printers

# 3. Test connection
# Choose: Connection Test

# 4. Print test receipt
# Choose: Print Test Receipt

# 5. Verify agent is running
curl http://localhost:3001/health
```

### Expected Output
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "uptime": 123.45,
  "platform": "android",
  "nodeVersion": "v18.x.x",
  "connectedPrinters": ["192.168.1.100:9100"],
  "serverConnection": "connected"
}
```

## 🚨 Emergency Recovery

### If Agent Won't Start
```bash
# Kill any existing processes
pkill -f "node agent.js"
rm -f agent.pid

# Check logs
tail -f logs/agent.log

# Reset configuration
cp config-template.json config.json

# Restart with debug mode
NODE_ENV=development node agent.js
```

### If Termux is Corrupted
```bash
# Backup your config
cp ~/hilfex-print-agent/config.json /sdcard/

# Clear Termux data in Android Settings
# Reinstall Termux from F-Droid
# Restore config from /sdcard/
```

## 📞 Support and Maintenance

### Log Files
- **Agent Log**: `~/hilfex-print-agent/logs/agent.log`
- **Termux Log**: Use `logcat` command
- **System Log**: Android's built-in logging

### Regular Maintenance
```bash
# Weekly updates
pkg update && pkg upgrade

# Clean old logs
find logs/ -name "*.log" -mtime +7 -delete

# Restart agent
./stop-agent.sh && ./start-agent.sh
```

### Performance Monitoring
```bash
# Check memory usage
free -h

# Check disk space
df -h

# Check process status
ps aux | grep node
```

## 🔄 Auto-Start Configuration

### Method 1: Termux Boot Package
```bash
# Install termux-services
pkg install termux-services

# Restart Termux after installation
# Create service script
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/hilfex-agent.service << 'EOF'
[Unit]
Description=HilfeX Print Agent

[Service]
Type=simple
ExecStart=/data/data/com.termux/files/home/hilfex-print-agent/start-agent.sh
Restart=always

[Install]
WantedBy=default.target
EOF

# Enable service
systemctl --user enable hilfex-agent.service
```

### Method 2: Boot Script
```bash
# Create boot script
mkdir -p ~/.termux/boot
cat > ~/.termux/boot/hilfex-agent << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
cd ~/hilfex-print-agent
./start-agent.sh
EOF

chmod +x ~/.termux/boot/hilfex-agent
```

## 🌟 Advanced Features

### WebSocket Client Example
```javascript
const ws = new WebSocket('ws://TABLET_IP:3002');

ws.on('open', () => {
    // Send print job
    ws.send(JSON.stringify({
        type: 'print',
        payload: {
            data: 'Receipt text here...',
            printer: { host: '192.168.1.100', port: 9100 },
            protocol: 'raw',
            format: 'escpos'
        }
    }));
});
```

### REST API Usage
```bash
# Discover printers
curl http://TABLET_IP:3001/api/discover-printers

# Send print job
curl -X POST http://TABLET_IP:3001/api/print \
  -H "Content-Type: application/json" \
  -d '{
    "data": "Test receipt content",
    "printer": {"host": "192.168.1.100", "port": 9100},
    "protocol": "raw",
    "format": "escpos"
  }'
```

## 📝 Configuration Reference

### config.json Structure
```json
{
  "port": 3001,
  "wsPort": 3002,
  "serverUrl": "http://192.168.1.100:5000",
  "printerDiscoveryTimeout": 5000,
  "maxRetries": 3,
  "retryDelay": 2000,
  "healthCheckInterval": 30000,
  "printers": [
    {
      "id": "main-printer",
      "name": "Kitchen Printer",
      "host": "192.168.1.100",
      "port": 9100,
      "protocol": "raw",
      "format": "escpos",
      "enabled": true
    }
  ]
}
```

This comprehensive guide should resolve the compatibility issues you mentioned and provide a robust Android printing solution for your Lenovo tablet.