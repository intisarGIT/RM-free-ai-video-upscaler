import Alpine from 'alpinejs';
import ImageCompare from './lib/image-compare-viewer.min';
import WebSR from '@websr/websr';
import type { WorkerRequestMessage, WorkerResponseMessage } from './types/worker-messages';

import 'bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';
import "./index.css";
import "./lib/image-compare-viewer.min.css";

const MAX_FILE_BLOB_SIZE=1900*1024*1024; //Just under 2GB, max ArrayBufferSize

// Web Worker for video processing
const worker = new Worker(new URL('./worker.ts', import.meta.url));

// Canvas and video elements
let upscaled_canvas: HTMLCanvasElement;
let original_canvas: HTMLCanvasElement;
let video: HTMLVideoElement;

// Network selection
type NetworkSize = 'small' | 'medium' | 'large';
type ContentType = 'rl' | 'an' | '3d';

let size: NetworkSize = 'medium';
let content: ContentType = 'rl';

// Video data
let download_name: string;
let inputFileHandle: FileSystemFileHandle;
let gpu: any;
let websr: WebSR;
let activeBackend: 'webgpu' | 'webgl' | null = null;
let videoUpscaled: HTMLVideoElement | null = null;
let imageCompareViewer: any = null;

// AI model weights for different network sizes and content types
type WeightsMap = {
    [K in NetworkSize]: {
        [C in ContentType]: any;
    };
};

const weights: WeightsMap = {
    'large': {
        'rl': require('./weights/cnn-2x-l-rl.json'),
        'an': require('./weights/cnn-2x-l-an.json'),
        '3d': require('./weights/cnn-2x-l-3d.json'),
    },
    'medium': {
        'rl': require('./weights/cnn-2x-m-rl.json'),
        'an': require('./weights/cnn-2x-m-an.json'),
        '3d': require('./weights/cnn-2x-m-3d.json'),
    },
    'small': {
        'rl': require('./weights/cnn-2x-s-rl.json'),
        'an': require('./weights/cnn-2x-s-an.json'),
        '3d': require('./weights/cnn-2x-s-3d.json'),
    }
};

// Network name mapping
const networks: Record<NetworkSize, { name: string }> = {
    'small': {
        name: "anime4k/cnn-2x-s",
    },
    'medium': {
        name: "anime4k/cnn-2x-m",
    },
    'large': {
        name: "anime4k/cnn-2x-l",
    }
};

// Declare global window functions for Alpine to call and File System Access API
declare global {
    interface Window {
        chooseFile: (e?: Event) => Promise<void>;
        initRecording: () => Promise<void>;
        fullScreenPreview: (e?: Event) => Promise<void>;
        switchNetworkSize: (el: HTMLInputElement) => Promise<void>;
        switchNetworkStyle: (el: HTMLInputElement) => Promise<void>;
        showSaveFilePicker: (options?: any) => Promise<FileSystemFileHandle>;
        showOpenFilePicker: (options?: any) => Promise<FileSystemFileHandle[]>;
        togglePause: () => void;
        cancelUpscaling: () => void;
        togglePlayback: () => void;
        seekPlayback: (val: string) => void;
        formatTime: (secs: number) => string;
    }
}

document.addEventListener("DOMContentLoaded", index);

//===================  Initial Load ===========================

/**
 * Main initialization function called on page load
 */
async function index(): Promise<void> {
    Alpine.store('state', 'init');
    Alpine.store('playbackPlaying', false);
    Alpine.store('playbackTime', 0);
    Alpine.store('videoDuration', 0);

    Alpine.start();
    document.body.style.display = "block";

    upscaled_canvas = document.getElementById("upscaled") as HTMLCanvasElement;
    original_canvas = document.getElementById('original') as HTMLCanvasElement;

    if (!("VideoEncoder" in window)) return showUnsupported("WebCodecs");

    if (!window.showSaveFilePicker) return showUnsupported("File Write System API");

    worker.postMessage({ cmd: 'isSupported' } satisfies WorkerRequestMessage);

    window.chooseFile = chooseFile;
}

function getPreviewHeight(): number {
    return Math.max(220, Math.min(420, window.innerHeight - 370));
}

/** Sync the #settings bar width to match the video preview container */
function syncSettingsWidth() {
    const imageCompare = document.getElementById('image-compare-outer') as HTMLElement;
    const settings = document.getElementById('settings') as HTMLElement;
    if (imageCompare && settings) {
        const w = imageCompare.offsetWidth || imageCompare.getBoundingClientRect().width;
        if (w > 0) {
            settings.style.width = `${w}px`;
            settings.style.minWidth = '';
        }
    }
}

function setFullScreenLocation(): void {
    const fullScreenButton = document.getElementById('full-screen');
    const imageCompare = document.getElementById('image-compare-outer');
    if (!fullScreenButton || !imageCompare || !video) return;

    const previewHeight = getPreviewHeight();
    const containerWidth = Math.round(video.videoWidth / video.videoHeight * previewHeight);
    const containerHeight = previewHeight;
    
    // Position at bottom-right of the preview container (with small padding)
    fullScreenButton.style.left = `${imageCompare.offsetLeft + containerWidth - 20}px`;
    fullScreenButton.style.top = `${imageCompare.offsetTop + containerHeight - 20}px`;
}

function updateDimensions(): void {
    if (document.fullscreenElement || !video) return;
    const previewHeight = getPreviewHeight();
    const previewWidth = Math.round(video.videoWidth / video.videoHeight * previewHeight);
    
    const imageCompare = document.getElementById('image-compare-outer');
    if (imageCompare) {
        imageCompare.style.height = `${previewHeight}px`;
        imageCompare.style.width = `${previewWidth}px`;
    }
    
    const imageCompareInner = document.getElementById('image-compare');
    if (imageCompareInner) {
        imageCompareInner.style.height = `${previewHeight}px`;
        imageCompareInner.style.width = `${previewWidth}px`;
    }

    const singlePreviewContainer = document.getElementById('single-preview-container');
    if (singlePreviewContainer) {
        singlePreviewContainer.style.height = `${previewHeight}px`;
        singlePreviewContainer.style.width = `${previewWidth}px`;
    }
    
    setFullScreenLocation();
    syncSettingsWidth();
}

/**
 * Show unsupported browser feature message
 */
function showUnsupported(text: string): void {
    Alpine.store('component', text);
    Alpine.store('state', 'unsupported');
}

/**
 * Prompt user to choose a video file using File System Access API
 */
async function chooseFile(e?: Event): Promise<void> {
    try {
        const [fileHandle] = await window.showOpenFilePicker({
            types: [{
                description: 'Video Files',
                accept: { 'video/mp4': ['.mp4'] }
            }],
            multiple: false
        });

        await loadVideo(fileHandle);
    } catch (e) {
        // User cancelled file picker
        console.log('File selection cancelled');
    }
}

//===================  Preview ===========================

/**
 * Load video file from FileSystemFileHandle
 */
async function loadVideo(fileHandle: FileSystemFileHandle): Promise<void> {
    Alpine.store('state', 'loading');

    // Store the file handle for later processing
    inputFileHandle = fileHandle;

    // Get the file to create a preview
    const file = await fileHandle.getFile();

    // Set up download name
    download_name = file.name.split(".")[0] + "-upscaled.mp4";
    Alpine.store('download_name', download_name);
    Alpine.store('filename', file.name);

    // Read file for preview setup
    const arrayBuffer = await file.arrayBuffer();
    await setupPreview(arrayBuffer);
}

/**
 * Set up the preview UI with before/after comparison
 */
async function setupPreview(data: ArrayBuffer): Promise<void> {
    video = document.createElement('video');

    const fileBlob = new Blob([data], { type: "video/mp4" });

    video.src = URL.createObjectURL(fileBlob);

    const imageCompare = document.getElementById('image-compare-outer') as HTMLElement;



    video.onloadeddata = async function (){



        Alpine.store('width', video.videoWidth);
        Alpine.store('height', video.videoHeight);
        upscaled_canvas.width = video.videoWidth*2;
        upscaled_canvas.height = video.videoHeight*2;
        original_canvas.width = video.videoWidth*2;
        original_canvas.height = video.videoHeight*2;


        const singlePreviewContainer = document.getElementById('single-preview-container') as HTMLElement;
        const singlePreviewCanvas = document.getElementById('single-preview') as HTMLCanvasElement;

        const previewHeight = getPreviewHeight();
        const previewWidth = Math.round(video.videoWidth / video.videoHeight * previewHeight);

        imageCompare.style.height = `${previewHeight}px`;
        imageCompare.style.width =  `${previewWidth}px`;
        imageCompare.style.margin = 'auto';
        imageCompare.style.position = 'relative';

        singlePreviewContainer.style.height = `${previewHeight}px`;
        singlePreviewContainer.style.width = `${previewWidth}px`;
        singlePreviewContainer.style.margin = 'auto';
        singlePreviewContainer.style.position = 'relative';

        singlePreviewCanvas.width = video.videoWidth;
        singlePreviewCanvas.height = video.videoHeight;

        // Keep video frozen at preview frame; do NOT animate via requestVideoFrameCallback here.
        // We seek to 20% in to show a representative frame.
        video.currentTime = video.duration * 0.2 || 0;
        video.pause();
        
        // Initialize canvas+worker on first seeked event, then re-render on subsequent seeks
        let workerInitialized = false;
        video.onseeked = function() {
            const ctx2d = singlePreviewCanvas.getContext('2d');
            if (ctx2d) {
                ctx2d.drawImage(video, 0, 0);
            }

            if (!workerInitialized) {
                workerInitialized = true;
                showPreview();
            } else if (Alpine.store('state') === 'preview') {
                renderPreviewFrame();
            }
        };

        window.togglePause = function () {
            const currentState = Alpine.store('state');
            if (currentState === 'processing') {
                worker.postMessage({ cmd: 'pause' } satisfies WorkerRequestMessage);
            } else if (currentState === 'paused') {
                worker.postMessage({ cmd: 'resume' } satisfies WorkerRequestMessage);
            }
        };

        window.cancelUpscaling = function () {
            worker.postMessage({ cmd: 'cancel' } satisfies WorkerRequestMessage);
        };

    }




    async function showPreview(){

        const fullScreenButton = document.getElementById('full-screen');


        window.initRecording = initRecording;
        window.fullScreenPreview = fullScreenPreview;

        const bitmap = await createImageBitmap(video);

        const upscaled = upscaled_canvas.transferControlToOffscreen();
        const original = original_canvas.transferControlToOffscreen();

        worker.postMessage({cmd: "init", data: {
                bitmap,
                upscaled,
                original,
                resolution: {
                    width: video.videoWidth,
                    height: video.videoHeight
                }

            }}, [bitmap, upscaled, original]);


        // Default to 'rl' (real life) network
        content = 'rl';
        await updateNetwork();
        Alpine.store('style', 'rl');

        setTimeout(syncSettingsWidth, 50);
        setTimeout(syncSettingsWidth, 200);
        setTimeout(syncSettingsWidth, 500);









        window.addEventListener('resize', updateDimensions);

        setTimeout(setFullScreenLocation, 20);
        setTimeout(setFullScreenLocation, 60);
        setTimeout(setFullScreenLocation, 200);

        imageCompare.addEventListener('fullscreenchange', function () {
            if(!document.fullscreenElement){
                // Reset canvas styles
                upscaled_canvas.style.width = ``;
                upscaled_canvas.style.height = ``;
                original_canvas.style.width = ``;
                original_canvas.style.height = ``;
                
                // Reset container styles to original preview dimensions
                const imageCompareOuter = document.getElementById('image-compare-outer');
                const imageCompareInner = document.getElementById('image-compare');
                
                // Reset outer container
                imageCompareOuter.style.width = ``;
                imageCompareOuter.style.height = ``;
                imageCompareOuter.style.backgroundColor = ``;
                imageCompareOuter.style.display = ``;
                imageCompareOuter.style.justifyContent = ``;
                imageCompareOuter.style.alignItems = ``;
                
                // Reset inner container to original preview size
                const previewHeight = getPreviewHeight();
                imageCompareInner.style.height = `${previewHeight}px`;
                imageCompareInner.style.width = `${Math.round(video.videoWidth/video.videoHeight*previewHeight)}px`;
                imageCompareInner.style.margin = 'auto';
                imageCompareInner.style.position = 'relative';
            }
        });

        let bitrate = getBitrate();

        const estimated_size = (bitrate/8)*video.duration + (128/8)*video.duration; // Assume 128 kbps audio

        if(estimated_size > MAX_FILE_BLOB_SIZE){
            Alpine.store('target', 'writer');
        } else {
            Alpine.store('target', 'blob');
        }

        const quota = (await navigator.storage.estimate()).quota;

        if(estimated_size > quota){
            return showError(`The video is too big. It would output a file of ${humanFileSize(estimated_size)} but the browser can only write files up to ${humanFileSize(quota)}`);
        }


        Alpine.store('size', humanFileSize(estimated_size))


        function canvasFullScreen(){
            // Calculate aspect ratios
            const videoAspectRatio = video.videoWidth / video.videoHeight;
            const screenAspectRatio = window.innerWidth / window.innerHeight;
            
            let displayWidth, displayHeight;

            const imageCompareOuter = document.getElementById('image-compare-outer');
            const imageCompareInner = document.getElementById('image-compare');
            
            // If video is wider than screen, fit to width (letterbox on top/bottom)
            if (videoAspectRatio > screenAspectRatio) {
                displayWidth = window.innerWidth;
                displayHeight = window.innerWidth / videoAspectRatio;
            } 
            // If video is taller than screen, fit to height (pillarbox on sides)
            else {
                displayWidth = window.innerHeight * videoAspectRatio;
                displayHeight = window.innerHeight;
            }
            
            // Style the outer container to fill screen with black background and center content
            imageCompareOuter.style.width = `${window.innerWidth}px`;
            imageCompareOuter.style.height = `${window.innerHeight}px`;
            imageCompareOuter.style.backgroundColor = 'black';
            imageCompareOuter.style.display = 'flex';
            imageCompareOuter.style.justifyContent = 'center';
            imageCompareOuter.style.alignItems = 'center';
            

            console.log("Image Compare Outer", imageCompareOuter);
            console.log("Image Compare Inner", imageCompareInner);
            // Size the inner container to maintain aspect ratio
            imageCompareInner.style.width = `${displayWidth}px`;
            imageCompareInner.style.height = `${displayHeight}px`;
            
            // Let the canvases fill their parent container
            upscaled_canvas.style.width = `${displayWidth}px`;
            upscaled_canvas.style.height = `${displayHeight}px`;
            original_canvas.style.width = `${displayWidth}px`;
            original_canvas.style.height = `${displayHeight}px`;
        }

        async function fullScreenPreview(e) {
            imageCompare.requestFullscreen();
            setTimeout(canvasFullScreen, 20);
            setTimeout(canvasFullScreen, 60);
            setTimeout(canvasFullScreen, 200);

        }


        Alpine.store('state', 'preview');




        window.switchNetworkSize = async function(el: HTMLInputElement){
            if(el.value !== size){
                size = el.value as NetworkSize;
                await updateNetwork();
                // Re-render preview frame after network switch
                renderPreviewFrame();
            }
        }

        window.switchNetworkStyle = async function(el: HTMLInputElement){
            if(el.value !== content){
                content = el.value as ContentType;
                await updateNetwork();
                // Re-render preview frame after network switch
                renderPreviewFrame();
            }
        }



    }

}


/**
 * Handle messages from the video processing worker
 */
worker.onmessage = function (event: MessageEvent<WorkerResponseMessage>) {
    if (event.data.cmd === 'isSupported') {
        const { supported, backend, missingFeature } = event.data.data;
        activeBackend = backend;

        if (!supported) return showUnsupported(missingFeature || "WebGPU");
        console.log(`[Main]: Backend selected by worker: ${backend}`);

    } else if (event.data.cmd === 'progress') {
        Alpine.store('progress', event.data.data);
        if (Alpine.store('state') !== 'paused') {
            Alpine.store('state', 'processing');
        }

    } else if (event.data.cmd === 'process') {
        // Processing started

    } else if (event.data.cmd === 'error') {
        showError(event.data.data);

    } else if (event.data.cmd === 'eta') {
        Alpine.store('eta', event.data.data);

    } else if (event.data.cmd === 'finished') {
        Alpine.store('state', 'complete');
        const url = event.data.data ? window.URL.createObjectURL(event.data.data) : null;
        Alpine.store('download_url', url);
        if (url) {
            videoUpscaled = document.createElement('video');
            videoUpscaled.src = url;
            videoUpscaled.muted = true;
            videoUpscaled.playsInline = true;
            video.pause();
            
            Alpine.store('videoDuration', video.duration || 0);
            Alpine.store('playbackTime', video.currentTime);
            Alpine.store('playbackPlaying', false);

            // Once the upscaled video metadata is loaded, seek both to current position and render
            videoUpscaled.onloadeddata = function() {
                videoUpscaled.currentTime = video.currentTime;
                videoUpscaled.onseeked = function() {
                    updateDimensions();
                    renderScrubFrame();

                    // Mount ImageCompare slider if not already mounted
                    if (!imageCompareViewer) {
                        imageCompareViewer = new ImageCompare(document.getElementById('image-compare'));
                        imageCompareViewer.mount();
                    } else {
                        try {
                            imageCompareViewer.update?.();
                        } catch (e) {
                            console.warn("ImageCompare update failed:", e);
                        }
                    }
                };
            };
            videoUpscaled.load();
        }
    }
    else if (event.data.cmd === 'paused') {
        Alpine.store('state', 'paused');
    } else if (event.data.cmd === 'resumed') {
        Alpine.store('state', 'processing');
    } else if (event.data.cmd === 'cancelled') {
        Alpine.store('state', 'preview');
    }
};

/**
 * Render the current frame from the original video to the comparison canvas (preview mode).
 * Sends a bitmap of the current video frame to the worker to display on the canvas.
 */
async function renderPreviewFrame(): Promise<void> {
    if (!video || video.readyState < 2) return;
    try {
        const bitmap = await createImageBitmap(video);
        worker.postMessage({ cmd: 'previewFrame', data: { bitmap } }, [bitmap]);
    } catch (e) {
        // Ignore errors during rapid seek
    }
}

/**
 * Render a comparison frame from both original and upscaled video at the current scrub position.
 * Used by the frame scrubber after processing is complete.
 */
async function renderScrubFrame(): Promise<void> {
    if (!video || !videoUpscaled) return;
    try {
        // Ensure both are paused at the same time
        const [originalBitmap, upscaledBitmap] = await Promise.all([
            createImageBitmap(video),
            createImageBitmap(videoUpscaled)
        ]);
        worker.postMessage({
            cmd: 'playbackFrame',
            data: { original: originalBitmap, upscaled: upscaledBitmap }
        }, [originalBitmap, upscaledBitmap]);
    } catch (e) {
        // Ignore fast seek errors
    }
}

// Global player control functions — scrubber-based, no play/pause
window.seekPlayback = function(val: string) {
    const time = parseFloat(val);
    Alpine.store('playbackTime', time);
    video.currentTime = time;
    if (videoUpscaled) {
        videoUpscaled.currentTime = time;
        // Render once both are seeked
        let pending = videoUpscaled ? 2 : 1;
        const onSeeked = () => {
            pending--;
            if (pending <= 0) renderScrubFrame();
        };
        video.onseeked = onSeeked;
        if (videoUpscaled) videoUpscaled.onseeked = onSeeked;
    } else {
        // Still in preview mode
        video.onseeked = function() { renderPreviewFrame(); };
    }
};

window.formatTime = function(secs: number): string {
    if (isNaN(secs) || secs === Infinity) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
};




/**
 * Switch to a different upscaling network
 */
async function updateNetwork(): Promise<void> {
    const bitmap = await createImageBitmap(video);

    let networkName = networks[size].name;
    let networkWeights = weights[size][content];

    if (activeBackend === 'webgl') {
        networkName = 'anime4k/cnn-2x-l';
        networkWeights = weights['large'][content];
        console.log(`[WebGL Fallback Mapping]: Mapping network size '${size}' to 'anime4k/cnn-2x-l' for style '${content}'`);
    }

    worker.postMessage({
        cmd: 'network',
        data: {
            name: networkName,
            bitmap,
            weights: networkWeights
        }
    } satisfies WorkerRequestMessage);
}

//===================  Process ===========================

/**
 * Start the video upscaling process
 */
async function initRecording(): Promise<void> {
    Alpine.store('state', 'loading');

    let bitrate = getBitrate();
    const estimated_size = (bitrate / 8) * video.duration + (128 / 8) * video.duration; // Assume 128 kbps audio

    let outputHandle: FileSystemFileHandle | undefined;

    // Max Blob size - 10 MB (for testing, should be much higher in production)
    if (estimated_size > MAX_FILE_BLOB_SIZE) {
        try {
            outputHandle = await showFilePicker();
        } catch (e) {
            console.warn("User aborted request");
            return Alpine.store('state', 'preview');
        }
    }

    worker.postMessage({
        cmd: "process",
        inputHandle: inputFileHandle,
        outputHandle
    } satisfies WorkerRequestMessage);
}

/**
 * Display error message to user
 */
function showError(message: string): void {
    Alpine.store('state', 'error');
    Alpine.store('error', message);
}

/**
 * Calculate target bitrate based on video resolution
 */
function getBitrate(): number {
    return 5e6 * Math.sqrt((video.videoWidth * video.videoHeight * 4) / (1280 * 720));
}

/**
 * Format bytes into human-readable file size
 */
function humanFileSize(bytes: number, si: boolean = false, dp: number = 1): string {
    const thresh = si ? 1000 : 1024;

    if (Math.abs(bytes) < thresh) {
        return bytes + ' B';
    }

    const units = si
        ? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
        : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
    let u = -1;
    const r = 10 ** dp;

    do {
        bytes /= thresh;
        ++u;
    } while (Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1);

    return bytes.toFixed(dp) + ' ' + units[u];
}

/**
 * Show native file picker for saving output video
 */
async function showFilePicker(): Promise<FileSystemFileHandle> {
    const handle = await window.showSaveFilePicker({
        startIn: 'downloads',
        suggestedName: download_name,
        types: [{
            description: 'Video File',
            accept: { 'video/mp4': ['.mp4'] }
        }],
    });

    return handle;
}












