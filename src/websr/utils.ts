export function isHTMLVideoElement(source: any): source is HTMLVideoElement {
    return typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement;
}
export function isHTMLImageElement(source: any): source is HTMLImageElement {
    return typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement;
}
export function isImageBitmap(source: any): source is ImageBitmap {
    return typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap;
}
export function isVideoFrame(source: any): source is VideoFrame {
    return typeof VideoFrame !== 'undefined' && source instanceof VideoFrame;
}
export function getSourceWidth(source: any): number {
    if (isHTMLVideoElement(source))
        return source.videoWidth;
    if (isHTMLImageElement(source))
        return source.naturalWidth;
    if (isVideoFrame(source))
        return source.displayWidth;
    if (isImageBitmap(source))
        return source.width;
    return 0;
}
export function getGPUTier(tier: any): number {
    if (!tier)
        return 1;
    let gpuTier = tier.tier;
    if (!gpuTier)
        return 1;
    if (tier.isMobile) {
        gpuTier = Math.max(gpuTier - 1, 1);
    }
    return gpuTier;
}
export function getSourceHeight(source: any): number {
    if (isHTMLVideoElement(source))
        return source.videoHeight;
    if (isHTMLImageElement(source))
        return source.naturalHeight;
    if (isVideoFrame(source))
        return source.displayHeight;
    if (isImageBitmap(source))
        return source.height;
    return 0;
}