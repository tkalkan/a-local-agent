#!/data/data/com.termux/files/usr/bin/bash

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

AGENT_DIR="$HOME/hilfex-print-agent"
NODE_VERSION="18"
REQUIRED_PACKAGES="nodejs npm git curl wget"

log() {
    echo -e "${CYAN}[$(date '+%H:%M:%S')]${NC} $1"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

echo -e "${BOLD}${BLUE}"
echo "##############################################################################"
echo "#                    HilfeX Android Print Agent Installer                   #"
echo "#                        Lenovo Tablet Compatible                           #"
echo "##############################################################################"
echo -e "${NC}"

if [[ ! "$PREFIX" == *"com.termux"* ]]; then
    log_error "This script must be run in Termux!"
    log_info "Download Termux from F-Droid: https://f-droid.org/en/packages/com.termux/"
    exit 1
fi

log_success "Running in Termux environment"

if command -v getprop &> /dev/null; then
    ANDROID_VERSION=$(getprop ro.build.version.release)
    log_success "Android version: $ANDROID_VERSION"
else
    log_warning "Could not detect Android version"
fi

log "Updating package repositories..."
if ! pkg update -y; then
    log_error "Failed to update package repositories"
    log_info "Try running: pkg update manually"
    exit 1
fi
log_success "Package repositories updated"

log "Upgrading existing packages..."
if ! pkg upgrade -y; then
    log_warning "Some packages could not be upgraded (this is usually OK)"
fi
log_success "Package upgrade completed"

log "Installing required packages: $REQUIRED_PACKAGES"
for package in $REQUIRED_PACKAGES; do
    log "Installing $package..."
    if pkg install -y "$package"; then
        log_success "$package installed"
    else
        log_error "Failed to install $package"
        
        case $package in
            "wget")
                log_warning "wget failed to install (optional for downloads)"
                ;;
            *)
                log_error "Critical package $package failed to install"
                exit 1
                ;;
        esac
    fi
done

log "Verifying Node.js installation..."
if command -v node &> /dev/null; then
    NODE_CURRENT=$(node --version)
    log_success "Node.js installed: $NODE_CURRENT"
else
    log_error "Node.js installation failed"
    exit 1
fi

if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    log_success "npm installed: v$NPM_VERSION"
else
    log_error "npm installation failed"
    exit 1
fi

log "Setting up directory structure..."
mkdir -p "$AGENT_DIR"
cd "$AGENT_DIR"

if [[ ! -f "agent.js" ]]; then
    log_info "Agent files not found in current directory"
    log_info "Please copy the agent files to: $AGENT_DIR"
    log_info "Required files: agent.js, package.json, setup.js, test-printer.js"
fi

if [[ -f "package.json" ]]; then
    log "Installing Node.js dependencies..."
    if npm install; then
        log_success "Dependencies installed successfully"
    else
        log_error "Failed to install dependencies"
        log_info "You may need to run: npm install --force"
    fi
else
    log_warning "package.json not found, skipping dependency installation"
fi

log "Setting up storage permissions..."
termux-setup-storage || log_warning "Storage setup failed (you may need to grant permissions manually)"

log "Creating startup script..."
cat > start-agent.sh << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash

cd "$HOME/hilfex-print-agent"

if [[ -f "agent.pid" ]]; then
    PID=$(cat agent.pid)
    if kill -0 $PID 2>/dev/null; then
        echo "Agent is already running (PID: $PID)"
        exit 1
    else
        rm agent.pid
    fi
fi

export NODE_ENV=production
export PORT=3001
export WS_PORT=3002

echo "Starting HilfeX Print Agent..."
node agent.js > logs/agent.log 2>&1 &
echo $! > agent.pid

echo "Agent started with PID: $(cat agent.pid)"
echo "Log file: logs/agent.log"
echo "Access URL: http://$(hostname -I | awk '{print $1}'):3001"

sleep 5
if command -v am >/dev/null 2>&1; then
    echo "Launching management interface..."
    am start -a android.intent.action.VIEW -d "https://digitalmenu.hilfex.com/management" >/dev/null 2>&1 || echo "Failed to launch browser"
fi
EOF

cat > stop-agent.sh << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash

cd "$HOME/hilfex-print-agent"

if [[ -f "agent.pid" ]]; then
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
EOF

cat > auto-restart.sh << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash

cd "$HOME/hilfex-print-agent"

while true; do
    if [ ! -f "agent.pid" ] || ! kill -0 $(cat agent.pid) 2>/dev/null; then
        echo "Agent not running, restarting..."
        ./start-agent.sh
    fi
    sleep 30
done
EOF

chmod +x start-agent.sh stop-agent.sh auto-restart.sh
log_success "Startup scripts created"

mkdir -p logs
log_success "Logs directory created"

cat > config-template.json << 'EOF'
{
  "port": 3001,
  "wsPort": 3002,
  "serverUrl": "http://192.168.1.100:5000",
  "printers": [],
  "autoStart": true,
  "debugMode": false,
  "printerDiscoveryTimeout": 5000,
  "maxRetries": 3,
  "retryDelay": 2000,
  "healthCheckInterval": 30000
}
EOF

HOSTNAME=$(hostname)
IP_ADDR=$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7}' | head -n1)
if [[ -z "$IP_ADDR" ]]; then
    IP_ADDR=$(ip addr show 2>/dev/null | grep 'inet ' | grep -v '127.0.0.1' | awk '{print $2}' | cut -d/ -f1 | head -n1)
fi

mkdir -p ~/.termux/boot
cat > ~/.termux/boot/hilfex-agent << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash

sleep 10

cd "$HOME/hilfex-print-agent"
./start-agent.sh

sleep 5
if command -v am >/dev/null 2>&1; then
    am start -a android.intent.action.VIEW -d "https://digitalmenu.hilfex.com/management" -f 0x10000000 >/dev/null 2>&1
fi

./auto-restart.sh &
EOF

chmod +x ~/.termux/boot/hilfex-agent
log_success "Termux boot script created"

log_success "Installation completed successfully!"

echo
echo -e "${BOLD}${GREEN}🎉 HilfeX Android Print Agent Installation Complete!${NC}"
echo
echo -e "${CYAN}📋 Quick Start Guide:${NC}"
echo -e "${WHITE}1. Copy agent files to: ${AGENT_DIR}${NC}"
echo -e "${WHITE}2. Install dependencies: npm install${NC}"
echo -e "${WHITE}3. Run setup: node setup.js${NC}"
echo -e "${WHITE}4. Test printer: node test-printer.js${NC}"
echo -e "${WHITE}5. Start agent: ./start-agent.sh${NC}"
echo

echo -e "${CYAN}🔗 Network Information:${NC}"
echo -e "${WHITE}Hostname: ${HOSTNAME}${NC}"
if [[ -n "$IP_ADDR" ]]; then
    echo -e "${WHITE}IP Address: ${IP_ADDR}${NC}"
    echo -e "${WHITE}Agent URL: http://${IP_ADDR}:3001${NC}"
    echo -e "${WHITE}WebSocket URL: ws://${IP_ADDR}:3002${NC}"
else
    echo -e "${YELLOW}IP Address: Could not detect (check manually)${NC}"
fi

echo
echo -e "${CYAN}🛠️  Useful Commands:${NC}"
echo -e "${WHITE}Start agent: ./start-agent.sh${NC}"
echo -e "${WHITE}Stop agent: ./stop-agent.sh${NC}"
echo -e "${WHITE}Test printer: node test-printer.js${NC}"
echo -e "${WHITE}View logs: tail -f logs/agent.log${NC}"
echo -e "${WHITE}Agent status: curl http://localhost:3001/health${NC}"

echo
echo -e "${CYAN}📱 Tablet Specific Tips:${NC}"
echo -e "${WHITE}• Keep Termux open in background${NC}"
echo -e "${WHITE}• Add Termux to battery optimization whitelist${NC}"
echo -e "${WHITE}• Use 'termux-wake-lock' to prevent sleep${NC}"
echo -e "${WHITE}• Enable 'Run in background' in Termux settings${NC}"

echo
echo -e "${BLUE}ℹ️  For troubleshooting, check the logs directory${NC}"
echo -e "${BLUE}ℹ️  Agent directory: ${AGENT_DIR}${NC}"
echo

echo -e "${YELLOW}⏭️  Next Steps:${NC}"
echo -e "${WHITE}1. Copy the a-local-agent files to this directory${NC}"
echo -e "${WHITE}2. Run 'npm install' to install dependencies${NC}"
echo -e "${WHITE}3. Run 'node setup.js' for interactive setup${NC}"
echo -e "${WHITE}4. Test your printer with 'node test-printer.js'${NC}"
echo