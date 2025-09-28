#!/bin/bash

# TypeScript Audio Transcriber - Build and Run Script
# Usage: ./run.sh [option]

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to show usage
show_usage() {
    echo -e "${BLUE}TypeScript Audio Transcriber - Build and Run Script${NC}"
    echo ""
    echo "Usage: ./run.sh [option]"
    echo ""
    echo "Options:"
    echo "  build         - Build TypeScript library only"
    echo "  dev           - Run in development mode with watch"
    echo "  demo          - Build and run Electron demo (development)"
    echo "  bundle        - Build complete app bundle (.app)"
    echo "  clean         - Clean all build artifacts"
    echo "  rebuild       - Clean and rebuild everything"
    echo "  test          - Run basic functionality tests"
    echo "  help          - Show this help message"
    echo ""
    echo "Examples:"
    echo "  ./run.sh build    # Build TypeScript library"
    echo "  ./run.sh demo     # Run development demo"
    echo "  ./run.sh bundle   # Create macOS app bundle"
    echo "  ./run.sh clean    # Clean all builds"
}

# Function to build TypeScript library
build_library() {
    print_status "Building TypeScript library..."
    npm run clean
    npm run build
    print_success "Library built successfully"
}

# Function to run development mode
run_dev() {
    print_status "Starting development mode with watch..."
    print_warning "Press Ctrl+C to stop"
    npm run dev
}

# Function to run demo
run_demo() {
    print_status "Building and running Electron demo..."
    build_library
    print_status "Starting Electron demo..."
    npm run demo
}

# Function to create app bundle
create_bundle() {
    print_status "Creating macOS app bundle..."
    build_library

    print_status "Cleaning previous bundles..."
    rm -rf dist-electron

    print_status "Building Electron app bundle..."
    npx electron-builder --dir --config.compression=store

    APP_PATH="dist-electron/mac-arm64/TS Audio Transcriber Demo.app"
    if [ -d "$APP_PATH" ]; then
        print_success "App bundle created successfully!"
        echo ""
        echo -e "${GREEN}App bundle location:${NC}"
        echo "  $(pwd)/$APP_PATH"
        echo ""
        echo -e "${BLUE}To run the app:${NC}"
        echo "  open \"$APP_PATH\""
        echo ""
        echo -e "${BLUE}To add to System Preferences:${NC}"
        echo "  1. Go to System Preferences > Security & Privacy > Privacy"
        echo "  2. Select 'Microphone' or 'Screen Recording'"
        echo "  3. Click '+' and select the app bundle above"
    else
        print_error "App bundle creation failed"
        exit 1
    fi
}

# Function to clean builds
clean_builds() {
    print_status "Cleaning build artifacts..."
    npm run clean
    rm -rf dist-electron
    rm -rf node_modules/.cache
    print_success "Clean completed"
}

# Function to rebuild everything
rebuild_all() {
    print_status "Rebuilding everything from scratch..."
    clean_builds
    build_library
    create_bundle
    print_success "Rebuild completed"
}

# Function to run basic tests
run_tests() {
    print_status "Running basic functionality tests..."
    build_library

    print_status "Checking if core classes can be imported..."
    node -e "
        try {
            const { AudioTranscriber, createTranscriber } = require('./dist/index.js');
            console.log('✅ AudioTranscriber class imported successfully');
            console.log('✅ createTranscriber function imported successfully');

            const transcriber = new AudioTranscriber();
            console.log('✅ AudioTranscriber instance created successfully');

            const transcriber2 = createTranscriber();
            console.log('✅ createTranscriber factory function works');

            console.log('✅ All basic tests passed');
        } catch (error) {
            console.error('❌ Test failed:', error.message);
            process.exit(1);
        }
    "

    print_success "Basic tests completed successfully"
}

# Function to show system info
show_system_info() {
    print_status "System Information:"
    echo "  Node.js: $(node --version)"
    echo "  npm: $(npm --version)"
    echo "  Platform: $(uname -s)"
    echo "  Architecture: $(uname -m)"
    echo ""

    print_status "Project Status:"
    if [ -d "dist" ]; then
        echo "  ✅ TypeScript build exists"
    else
        echo "  ❌ TypeScript build missing"
    fi

    if [ -d "dist-electron" ]; then
        echo "  ✅ Electron bundle exists"
    else
        echo "  ❌ Electron bundle missing"
    fi

    if [ -d "models" ]; then
        MODEL_COUNT=$(find models -name "vosk-model-*" -type d | wc -l | tr -d ' ')
        echo "  📦 Vosk models: $MODEL_COUNT found"
    else
        echo "  ❌ Models directory missing"
    fi
}

# Main script logic
case "${1:-help}" in
    "build")
        build_library
        ;;
    "dev")
        run_dev
        ;;
    "demo")
        run_demo
        ;;
    "bundle")
        create_bundle
        ;;
    "clean")
        clean_builds
        ;;
    "rebuild")
        rebuild_all
        ;;
    "test")
        run_tests
        ;;
    "info")
        show_system_info
        ;;
    "help"|*)
        show_usage
        ;;
esac