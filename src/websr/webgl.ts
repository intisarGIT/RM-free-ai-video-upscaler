import { getGPUTier, getSourceWidth, getSourceHeight } from './utils';

// WebGL2 Context manager
export class WebGLContext {
  gl: WebGL2RenderingContext;
  canvas: OffscreenCanvas | HTMLCanvasElement;
  processResolution: { width: number; height: number };
  canvasResolution: { width: number; height: number };
  scale: number;
  textures: { [key: string]: WebGLTexture } = {};
  framebuffers: { [key: string]: WebGLFramebuffer } = {};
  debug: boolean;
  outputResolution: { width: number; height: number };
  input: WebGLTexture;

  get resolution() {
    return this.processResolution;
  }

  constructor(gl: WebGL2RenderingContext, processResolution: any, canvasResolution: any, canvas: any, scale: number, debug: boolean, outputResolution: any) {
    this.gl = gl;
    this.canvas = canvas;
    this.processResolution = processResolution;
    this.canvasResolution = canvasResolution;
    this.scale = scale;
    this.debug = debug;
    this.outputResolution = outputResolution ?? { width: canvasResolution.width * scale, height: canvasResolution.height * scale };
    canvas.width = this.outputResolution.width;
    canvas.height = this.outputResolution.height;
  }

  texture(key: string, options: any = {}): WebGLTexture {
    if (!this.textures[key]) {
      const gl = this.gl;
      const width = options.width || this.processResolution.width;
      const height = options.height || this.processResolution.height;
      const format = options.format !== undefined ? options.format : gl.RGBA32F;
      const filter = options.filter !== undefined ? options.filter : gl.NEAREST;
      const tex = gl.createTexture();
      if (!tex) throw new Error(`Failed to create texture: ${key}`);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (format === gl.RGBA32F) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null);
      } else if (format === gl.R32F) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, null);
      } else {
        if (format !== gl.RGBA) throw new Error(`Unsupported texture format: ${format}`);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      this.textures[key] = tex;
    }
    return this.textures[key];
  }

  createTextureFromImage(key: string, image: TexImageSource): WebGLTexture {
    const gl = this.gl;
    let tex = this.textures[key];
    if (!tex) {
      tex = gl.createTexture();
      if (!tex) throw new Error(`Failed to create texture from image: ${key}`);
      this.textures[key] = tex;
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return tex;
  }

  createTextureFromSource(key: string, source: any, w: number, h: number): WebGLTexture {
    const gl = this.gl;
    let tex = this.textures[key];
    if (!tex) {
      tex = gl.createTexture();
      if (!tex) throw new Error(`Failed to create texture from source: ${key}`);
      this.textures[key] = tex;
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return tex;
  }

  framebuffer(key: string, textures: string[]): WebGLFramebuffer {
    if (!this.framebuffers[key]) {
      const gl = this.gl;
      const fb = gl.createFramebuffer();
      if (!fb) throw new Error(`Failed to create framebuffer: ${key}`);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      for (let i = 0; i < textures.length; i++) {
        const tex = this.textures[textures[i]];
        if (!tex) throw new Error(`Texture not found: ${textures[i]}`);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, tex, 0);
      }
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`Framebuffer incomplete: ${key}, status: ${status}`);
      }
      this.framebuffers[key] = fb;
    }
    return this.framebuffers[key];
  }

  cleanup() {
    const gl = this.gl;
    for (const key in this.textures) {
      gl.deleteTexture(this.textures[key]);
    }
    this.textures = {};
    for (const key in this.framebuffers) {
      gl.deleteFramebuffer(this.framebuffers[key]);
    }
    this.framebuffers = {};
  }

  async readTexture(key: string): Promise<Float32Array> {
    const gl = this.gl;
    const tex = this.textures[key];
    if (!tex) throw new Error(`Texture not found: ${key}`);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    let width = this.processResolution.width;
    let height = this.processResolution.height;
    if (key.includes("pixel_shuffle") || key.includes("output")) {
      width = 2 * this.processResolution.width;
      height = 2 * this.processResolution.height;
    }
    const pixels = new Float32Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, pixels);
    gl.deleteFramebuffer(fb);
    return pixels;
  }
}

// WebGL Base Layer
export class WebGLBaseLayer {
  context: WebGLContext;
  gl: WebGL2RenderingContext;
  resolution: { width: number; height: number };
  inputTextures: WebGLTexture[];
  outputTexture: WebGLTexture;
  weights: any;
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  framebuffer: WebGLFramebuffer;
  label: string;

  constructor(inputTextures: WebGLTexture[], outputTexture: WebGLTexture, weights?: any) {
    this.context = (globalThis as any).context;
    this.gl = this.context.gl;
    this.resolution = this.context.resolution;
    this.inputTextures = inputTextures;
    this.outputTexture = outputTexture;
    this.weights = weights;
  }

  vertexShader(): string {
    return `#version 300 es
        in vec2 a_position;
        in vec2 a_texCoord;
        out vec2 v_texCoord;

        void main() {
            gl_Position = vec4(a_position, 0.0, 1.0);
            v_texCoord = vec2(a_texCoord.x, 1.0 - a_texCoord.y);
        }`;
  }

  fragmentShader(): string {
    throw new Error("fragmentShader() must be implemented by subclass");
  }

  compileShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) throw new Error(`Failed to create shader for ${this.label}`);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      throw new Error(`Shader compile error in ${this.label}: ${log}\n\nSource:\n${source}`);
    }
    return shader;
  }

  createProgram() {
    const gl = this.gl;
    const vs = this.compileShader(gl.VERTEX_SHADER, this.vertexShader());
    const fs = this.compileShader(gl.FRAGMENT_SHADER, this.fragmentShader());
    const prog = gl.createProgram();
    if (!prog) throw new Error(`Failed to create program for ${this.label}`);
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog);
      throw new Error(`Program link error in ${this.label}: ${log}`);
    }
    this.program = prog;
    gl.deleteShader(vs);
    gl.deleteShader(fs);
  }

  setupGeometry() {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error(`Failed to create VAO for ${this.label}`);
    gl.bindVertexArray(vao);

    const pos = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(this.program, "a_position");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uv = new Float32Array([0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0]);
    const uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
    const aUv = gl.getAttribLocation(this.program, "a_texCoord");
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);

    this.vao = vao;
  }

  defaultSetup() {
    this.createProgram();
    this.setupGeometry();
  }

  setupUniforms() {
    throw new Error("setupUniforms() must be implemented by subclass");
  }

  run() {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    if (this.framebuffer === null) {
      gl.viewport(0, 0, this.context.canvas.width, this.context.canvas.height);
    } else {
      gl.viewport(0, 0, this.resolution.width, this.resolution.height);
    }
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.setupUniforms();
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}

// WebGL Bicubic Downscale
export class WebGLBicubicDownscale extends WebGLBaseLayer {
  inputWidth: number;
  inputHeight: number;
  flipY: boolean;

  constructor(e: any, t: number, n: number, r = false) {
    super([e], null);
    this.label = "BicubicDownscale";
    this.framebuffer = null;
    this.inputWidth = t;
    this.inputHeight = n;
    this.flipY = r;
  }

  vertexShader(): string {
    return `#version 300 es
        in vec2 a_position;
        in vec2 a_texCoord;
        out vec2 v_texCoord;
        uniform float u_flipY;

        void main() {
            gl_Position = vec4(a_position, 0.0, 1.0);
            v_texCoord = vec2(a_texCoord.x, mix(a_texCoord.y, 1.0 - a_texCoord.y, u_flipY));
        }`;
  }

  fragmentShader(): string {
    return `#version 300 es
        precision highp float;

        in vec2 v_texCoord;
        out vec4 outColor;

        uniform sampler2D u_input;
        uniform vec2 u_inputSize;

        float bicubic_weight(float t) {
            float abs_t = abs(t);
            if (abs_t >= 2.0) {
                return 0.0;
            }
            float t2 = t * t;
            float t3 = abs_t * t2;
            if (abs_t <= 1.0) {
                return 1.5 * t3 - 2.5 * t2 + 1.0;
            } else {
                return -0.5 * t3 + 2.5 * t2 - 4.0 * abs_t + 2.0;
            }
        }

        void main() {
            vec2 pixel_coord = v_texCoord * u_inputSize - 0.5;
            vec2 base_coord = floor(pixel_coord);
            vec2 fract_coord = pixel_coord - base_coord;

            vec3 result = vec3(0.0);
            float weight_sum = 0.0;

            for (int y = -1; y <= 2; y++) {
                for (int x = -1; x <= 2; x++) {
                    vec2 sample_coord = (base_coord + vec2(float(x), float(y)) + 0.5) / u_inputSize;
                    vec3 sample_color = texture(u_input, sample_coord).rgb;

                    float weight_x = bicubic_weight(fract_coord.x - float(x));
                    float weight_y = bicubic_weight(fract_coord.y - float(y));
                    float weight = weight_x * weight_y;

                    result += sample_color * weight;
                    weight_sum += weight;
                }
            }

            if (weight_sum > 0.0) {
                result = result / weight_sum;
            }

            outColor = vec4(result, 1.0);
        }`;
  }

  setupUniforms() {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.inputTextures[0]);
    const uInput = gl.getUniformLocation(this.program, "u_input");
    gl.uniform1i(uInput, 0);
    const uInputSize = gl.getUniformLocation(this.program, "u_inputSize");
    gl.uniform2f(uInputSize, this.inputWidth, this.inputHeight);
    const uFlipY = gl.getUniformLocation(this.program, "u_flipY");
    gl.uniform1f(uFlipY, this.flipY ? 1 : 0);
  }
}

// WebGL Passthrough
export class WebGLPassthrough extends WebGLBaseLayer {
  flipY: boolean;

  constructor(e: any, t = false) {
    super([e], null);
    this.label = "Passthrough";
    this.framebuffer = null;
    this.flipY = t;
  }

  vertexShader(): string {
    return `#version 300 es
        in vec2 a_position;
        in vec2 a_texCoord;
        out vec2 v_texCoord;
        uniform float u_flipY;

        void main() {
            gl_Position = vec4(a_position, 0.0, 1.0);
            v_texCoord = vec2(a_texCoord.x, mix(a_texCoord.y, 1.0 - a_texCoord.y, u_flipY));
        }`;
  }

  fragmentShader(): string {
    return `#version 300 es
        precision highp float;

        in vec2 v_texCoord;
        out vec4 outColor;

        uniform sampler2D u_input;

        void main() {
            outColor = texture(u_input, v_texCoord);
        }`;
  }

  setupUniforms() {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.inputTextures[0]);
    const uInput = gl.getUniformLocation(this.program, "u_input");
    gl.uniform1i(uInput, 0);
    const uFlipY = gl.getUniformLocation(this.program, "u_flipY");
    gl.uniform1f(uFlipY, this.flipY ? 1 : 0);
  }
}

// WebGL Conv2D 3x4
export class WebGLConv2D3x4 extends WebGLBaseLayer {
  constructor(e: any, t: any, n: any) {
    super(e, t, n);
    this.label = "Conv2D3x4";
  }

  fragmentShader(): string {
    return `#version 300 es
        precision highp float;

        in vec2 v_texCoord;
        out vec4 outColor;

        uniform sampler2D u_input;
        uniform vec2 u_inputSize;
        uniform mat4 u_kernels[9];
        uniform vec4 u_bias;

        void main() {
            vec2 offsets[9] = vec2[9](
                vec2(-1.0, -1.0), vec2(-1.0, 0.0), vec2(-1.0, 1.0),
                vec2(0.0, -1.0),  vec2(0.0, 0.0),  vec2(0.0, 1.0),
                vec2(1.0, -1.0),  vec2(1.0, 0.0),  vec2(1.0, 1.0)
            );

            vec4 result = vec4(0.0);
            ivec2 pixelCoord = ivec2(v_texCoord * u_inputSize);

            for (int i = 0; i < 9; i++) {
                ivec2 sampleCoord = pixelCoord + ivec2(offsets[i]);
                vec4 texel = texelFetch(u_input, sampleCoord, 0);
                result += u_kernels[i] * texel;
            }

            result += u_bias;
            outColor = result;
        }`;
  }

  setupUniforms() {
    const gl = this.gl;
    const uInputSize = gl.getUniformLocation(this.program, "u_inputSize");
    gl.uniform2f(uInputSize, this.resolution.width, this.resolution.height);
    const uBias = gl.getUniformLocation(this.program, "u_bias");
    gl.uniform4fv(uBias, new Float32Array(this.weights.bias));

    for (let i = 0; i < 9; i++) {
      const uKernel = gl.getUniformLocation(this.program, `u_kernels[${i}]`);
      const kernelData = this.weights.weights.slice(16 * i, 16 * (i + 1));
      gl.uniformMatrix4fv(uKernel, false, new Float32Array(kernelData));
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.inputTextures[0]);
    const uInput = gl.getUniformLocation(this.program, "u_input");
    gl.uniform1i(uInput, 0);

    gl.viewport(0, 0, this.resolution.width, this.resolution.height);
  }
}

// WebGL Conv2D 16x4
export class WebGLConv2D16x4 extends WebGLBaseLayer {
  constructor(e: any, t: any, n: any) {
    super(e, t, n);
    this.label = "Conv2D16x4";
  }

  fragmentShader(): string {
    return `#version 300 es
        precision highp float;

        in vec2 v_texCoord;
        out vec4 outColor;

        uniform sampler2D u_input0;
        uniform sampler2D u_input1;
        uniform vec2 u_inputSize;
        uniform mat4 u_kernels[36];
        uniform vec4 u_bias;

        void main() {
            vec2 offsets[9] = vec2[9](
                vec2(-1.0, -1.0), vec2(-1.0, 0.0), vec2(-1.0, 1.0),
                vec2(0.0, -1.0),  vec2(0.0, 0.0),  vec2(0.0, 1.0),
                vec2(1.0, -1.0),  vec2(1.0, 0.0),  vec2(1.0, 1.0)
            );

            vec4 result = vec4(0.0);
            ivec2 pixelCoord = ivec2(v_texCoord * u_inputSize);

            for (int i = 0; i < 9; i++) {
                ivec2 sampleCoord = pixelCoord + ivec2(offsets[i]);

                vec4 pix0 = texelFetch(u_input0, sampleCoord, 0);
                vec4 pix1 = texelFetch(u_input1, sampleCoord, 0);

                result += u_kernels[i] * max(pix0, vec4(0.0));
                result += u_kernels[i + 9] * max(pix1, vec4(0.0));

                result += u_kernels[i + 18] * max(-pix0, vec4(0.0));
                result += u_kernels[i + 27] * max(-pix1, vec4(0.0));
            }

            result += u_bias;
            outColor = result;
        }`;
  }

  setupUniforms() {
    const gl = this.gl;
    const uInputSize = gl.getUniformLocation(this.program, "u_inputSize");
    gl.uniform2f(uInputSize, this.resolution.width, this.resolution.height);
    const uBias = gl.getUniformLocation(this.program, "u_bias");
    gl.uniform4fv(uBias, new Float32Array(this.weights.bias));

    for (let i = 0; i < 36; i++) {
      const uKernel = gl.getUniformLocation(this.program, `u_kernels[${i}]`);
      const kernelData = this.weights.weights.slice(16 * i, 16 * (i + 1));
      gl.uniformMatrix4fv(uKernel, false, new Float32Array(kernelData));
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.inputTextures[0]);
    const uInput0 = gl.getUniformLocation(this.program, "u_input0");
    gl.uniform1i(uInput0, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.inputTextures[1]);
    const uInput1 = gl.getUniformLocation(this.program, "u_input1");
    gl.uniform1i(uInput1, 1);

    gl.viewport(0, 0, this.resolution.width, this.resolution.height);
  }
}

// WebGL Conv2D 112x4
export class WebGLConv2D112x4 extends WebGLBaseLayer {
  first: boolean;

  constructor(e: any, t: any, n: any, r: boolean) {
    super(e, t, n);
    this.label = "Conv2D112x4";
    this.first = r;
  }

  fragmentShader(): string {
    const codeLines: string[] = [];
    for (let i = 0; i < 7; i++) {
      if (this.first) {
        codeLines.push(`
          vec4 pixel_val${i} = texelFetch(u_input${i}, pixelCoord, 0);
          result += u_kernels[${4 * i}] * max(pixel_val${i}, vec4(0.0));
          result += u_kernels[${4 * i + 2}] * max(-pixel_val${i}, vec4(0.0));
        `);
      } else {
        codeLines.push(`
          vec4 pixel_val${i} = texelFetch(u_input${i}, pixelCoord, 0);
          result += u_kernels[${4 * i + 1}] * max(pixel_val${i}, vec4(0.0));
          result += u_kernels[${4 * i + 3}] * max(-pixel_val${i}, vec4(0.0));
        `);
      }
    }
    return `#version 300 es
        precision highp float;

        in vec2 v_texCoord;
        out vec4 outColor;

        uniform sampler2D u_input0;
        uniform sampler2D u_input1;
        uniform sampler2D u_input2;
        uniform sampler2D u_input3;
        uniform sampler2D u_input4;
        uniform sampler2D u_input5;
        uniform sampler2D u_input6;
        uniform vec2 u_inputSize;
        uniform mat4 u_kernels[28];

        void main() {
            vec4 result = vec4(0.0);
            ivec2 pixelCoord = ivec2(v_texCoord * u_inputSize);

            ${codeLines.join("\n")}

            outColor = result;
        }`;
  }

  setupUniforms() {
    const gl = this.gl;
    const uInputSize = gl.getUniformLocation(this.program, "u_inputSize");
    gl.uniform2f(uInputSize, this.resolution.width, this.resolution.height);

    for (let i = 0; i < 28; i++) {
      const uKernel = gl.getUniformLocation(this.program, `u_kernels[${i}]`);
      const kernelData = this.weights.weights.slice(16 * i, 16 * (i + 1));
      gl.uniformMatrix4fv(uKernel, false, new Float32Array(kernelData));
    }

    for (let i = 0; i < 7; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.inputTextures[i]);
      const uInput = gl.getUniformLocation(this.program, `u_input${i}`);
      gl.uniform1i(uInput, i);
    }

    gl.viewport(0, 0, this.resolution.width, this.resolution.height);
  }
}

// WebGL Concat2
export class WebGLConcat2 extends WebGLBaseLayer {
  constructor(e: any, t: any, n: any) {
    super(e, t, n);
    this.label = "Concat2";
  }

  vertexShader(): string {
    return `#version 300 es
        in vec2 a_position;
        in vec2 a_texCoord;
        out vec2 v_texCoord;

        void main() {
            gl_Position = vec4(a_position, 0.0, 1.0);
            v_texCoord = a_texCoord;
        }`;
  }

  fragmentShader(): string {
    return `#version 300 es
        precision highp float;

        in vec2 v_texCoord;
        out vec4 outColor;

        uniform sampler2D u_input0;
        uniform sampler2D u_input1;
        uniform vec2 u_inputSize;
        uniform vec4 u_bias;

        void main() {
            vec2 flippedCoord = vec2(v_texCoord.x, 1.0 - v_texCoord.y);
            ivec2 pixelCoord = ivec2(flippedCoord * u_inputSize);

            vec4 val0 = texelFetch(u_input0, pixelCoord, 0);
            vec4 val1 = texelFetch(u_input1, pixelCoord, 0);

            outColor = val0 + val1 + u_bias;
        }`;
  }

  setupUniforms() {
    const gl = this.gl;
    const uInputSize = gl.getUniformLocation(this.program, "u_inputSize");
    gl.uniform2f(uInputSize, this.resolution.width, this.resolution.height);
    const uBias = gl.getUniformLocation(this.program, "u_bias");
    gl.uniform4fv(uBias, new Float32Array(this.weights.bias));

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.inputTextures[0]);
    const uInput0 = gl.getUniformLocation(this.program, "u_input0");
    gl.uniform1i(uInput0, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.inputTextures[1]);
    const uInput1 = gl.getUniformLocation(this.program, "u_input1");
    gl.uniform1i(uInput1, 1);

    gl.viewport(0, 0, this.resolution.width, this.resolution.height);
  }
}

// WebGL DisplayLayer3C
export class WebGLDisplayLayer3C extends WebGLBaseLayer {
  constructor(e: any, t: any) {
    super(e, t);
    this.label = "DisplayLayer3C";
  }

  fragmentShader(): string {
    return `#version 300 es
        precision highp float;

        in vec2 v_texCoord;
        out vec4 outColor;

        uniform sampler2D u_channel0;
        uniform sampler2D u_channel1;
        uniform sampler2D u_channel2;
        uniform sampler2D u_original;
        uniform vec2 u_inputSize;

        float bicubic_weight(float t) {
            float abs_t = abs(t);
            if (abs_t >= 2.0) {
                return 0.0;
            }

            float t2 = t * t;
            float t3 = abs_t * t2;

            if (abs_t <= 1.0) {
                return 1.5 * t3 - 2.5 * t2 + 1.0;
            } else {
                return -0.5 * t3 + 2.5 * t2 - 4.0 * abs_t + 2.0;
            }
        }

        vec3 sampleBicubic(sampler2D tex, vec2 tex_coord) {
            vec2 tex_size = u_inputSize;
            vec2 pixel_coord = tex_coord * tex_size - 0.5;
            vec2 base_coord = floor(pixel_coord);
            vec2 fract_coord = pixel_coord - base_coord;

            vec3 result = vec3(0.0);
            float weight_sum = 0.0;

            for (int y = -1; y <= 2; y++) {
                for (int x = -1; x <= 2; x++) {
                    vec2 sample_coord = (base_coord + vec2(float(x), float(y)) + 0.5) / tex_size;
                    vec3 sample_color = texture(tex, sample_coord).rgb;

                    float weight_x = bicubic_weight(fract_coord.x - float(x));
                    float weight_y = bicubic_weight(fract_coord.y - float(y));
                    float weight = weight_x * weight_y;

                    result += sample_color * weight;
                    weight_sum += weight;
                }
            }

            if (weight_sum > 0.0) {
                result = result / weight_sum;
            }

            return result;
        }

        void main() {
            vec2 inputCoord = v_texCoord * u_inputSize;
            float x = inputCoord.x;
            float y = inputCoord.y;

            uint x_floor = uint(fract(x) * 2.0);
            uint y_floor = uint(fract(y) * 2.0);
            uint c_index = x_floor + y_floor * 2u;

            ivec2 inputCoordU = ivec2(inputCoord);

            vec4 pixel0 = texelFetch(u_channel0, inputCoordU, 0);
            vec4 pixel1 = texelFetch(u_channel1, inputCoordU, 0);
            vec4 pixel2 = texelFetch(u_channel2, inputCoordU, 0);

            float value0 = pixel0[c_index];
            float value1 = pixel1[c_index];
            float value2 = pixel2[c_index];

            vec3 bicubic = sampleBicubic(u_original, v_texCoord);

            outColor = vec4(bicubic + vec3(value0, value1, value2), 1.0);
        }`;
  }

  setupUniforms() {
    const gl = this.gl;
    const uInputSize = gl.getUniformLocation(this.program, "u_inputSize");
    gl.uniform2f(uInputSize, this.resolution.width, this.resolution.height);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.inputTextures[0]);
    const uChannel0 = gl.getUniformLocation(this.program, "u_channel0");
    gl.uniform1i(uChannel0, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.inputTextures[1]);
    const uChannel1 = gl.getUniformLocation(this.program, "u_channel1");
    gl.uniform1i(uChannel1, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.inputTextures[2]);
    const uChannel2 = gl.getUniformLocation(this.program, "u_channel2");
    gl.uniform1i(uChannel2, 2);

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.inputTextures[3]);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const uOriginal = gl.getUniformLocation(this.program, "u_original");
    gl.uniform1i(uOriginal, 3);

    gl.viewport(0, 0, 2 * this.resolution.width, 2 * this.resolution.height);
  }
}

// WebGL Conv2D 32x4
export class WebGLConv2D32x4 extends WebGLBaseLayer {
  constructor(e: any, t: any, n: any) {
    super(e, t, n);
    this.label = "Conv2D32x4";
  }

  fragmentShader(): string {
    return `#version 300 es
        precision highp float;

        in vec2 v_texCoord;
        out vec4 outColor;

        uniform sampler2D u_input0;
        uniform sampler2D u_input1;
        uniform sampler2D u_input2;
        uniform sampler2D u_input3;
        uniform vec2 u_inputSize;
        uniform mat4 u_kernels[72];
        uniform vec4 u_bias;

        void main() {
            vec2 offsets[9] = vec2[9](
                vec2(-1.0, -1.0), vec2(-1.0, 0.0), vec2(-1.0, 1.0),
                vec2(0.0, -1.0),  vec2(0.0, 0.0),  vec2(0.0, 1.0),
                vec2(1.0, -1.0),  vec2(1.0, 0.0),  vec2(1.0, 1.0)
            );

            vec4 result = vec4(0.0);
            ivec2 pixelCoord = ivec2(v_texCoord * u_inputSize);

            for (int i = 0; i < 9; i++) {
                ivec2 sampleCoord = pixelCoord + ivec2(offsets[i]);

                vec4 pix0 = texelFetch(u_input0, sampleCoord, 0);
                vec4 pix1 = texelFetch(u_input1, sampleCoord, 0);
                vec4 pix2 = texelFetch(u_input2, sampleCoord, 0);
                vec4 pix3 = texelFetch(u_input3, sampleCoord, 0);

                result += u_kernels[i] * max(pix0, vec4(0.0));
                result += u_kernels[i + 9] * max(pix1, vec4(0.0));
                result += u_kernels[i + 18] * max(pix2, vec4(0.0));
                result += u_kernels[i + 27] * max(pix3, vec4(0.0));

                result += u_kernels[i + 36] * max(-pix0, vec4(0.0));
                result += u_kernels[i + 45] * max(-pix1, vec4(0.0));
                result += u_kernels[i + 54] * max(-pix2, vec4(0.0));
                result += u_kernels[i + 63] * max(-pix3, vec4(0.0));
            }

            result += u_bias;
            outColor = result;
        }`;
  }

  setupUniforms() {
    const gl = this.gl;
    const uInputSize = gl.getUniformLocation(this.program, "u_inputSize");
    gl.uniform2f(uInputSize, this.resolution.width, this.resolution.height);
    const uBias = gl.getUniformLocation(this.program, "u_bias");
    gl.uniform4fv(uBias, new Float32Array(this.weights.bias));

    for (let i = 0; i < 72; i++) {
      const uKernel = gl.getUniformLocation(this.program, `u_kernels[${i}]`);
      const kernelData = this.weights.weights.slice(16 * i, 16 * (i + 1));
      gl.uniformMatrix4fv(uKernel, false, new Float32Array(kernelData));
    }

    for (let i = 0; i < 4; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.inputTextures[i]);
      const uInput = gl.getUniformLocation(this.program, `u_input${i}`);
      gl.uniform1i(uInput, i);
    }

    gl.viewport(0, 0, this.resolution.width, this.resolution.height);
  }
}

// WebGL Conv2D 224x4
export class WebGLConv2D224x4 extends WebGLBaseLayer {
  index: number;

  constructor(e: any, t: any, n: any, r: number) {
    super(e, t, n);
    this.label = "Conv2D224x4";
    this.index = r;
  }

  fragmentShader(): string {
    const codeLines: string[] = [];
    for (let i = 0; i < 7; i++) {
      const kernelPos = 8 * i + this.index;
      const kernelNeg = 8 * i + this.index + 4;
      codeLines.push(`
        vec4 pixel_val${i} = texelFetch(u_input${i}, pixelCoord, 0);
        result += u_kernels[${kernelPos}] * max(pixel_val${i}, vec4(0.0));
        result += u_kernels[${kernelNeg}] * max(-pixel_val${i}, vec4(0.0));
      `);
    }

    return `#version 300 es
        precision highp float;

        in vec2 v_texCoord;
        out vec4 outColor;

        uniform sampler2D u_input0;
        uniform sampler2D u_input1;
        uniform sampler2D u_input2;
        uniform sampler2D u_input3;
        uniform sampler2D u_input4;
        uniform sampler2D u_input5;
        uniform sampler2D u_input6;
        uniform vec2 u_inputSize;
        uniform mat4 u_kernels[56];

        void main() {
            vec4 result = vec4(0.0);
            ivec2 pixelCoord = ivec2(v_texCoord * u_inputSize);

            ${codeLines.join("\n")}

            outColor = result;
        }`;
  }

  setupUniforms() {
    const gl = this.gl;
    const uInputSize = gl.getUniformLocation(this.program, "u_inputSize");
    gl.uniform2f(uInputSize, this.resolution.width, this.resolution.height);

    for (let i = 0; i < 56; i++) {
      const uKernel = gl.getUniformLocation(this.program, `u_kernels[${i}]`);
      const kernelData = this.weights.weights.slice(16 * i, 16 * (i + 1));
      gl.uniformMatrix4fv(uKernel, false, new Float32Array(kernelData));
    }

    for (let i = 0; i < 7; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.inputTextures[i]);
      const uInput = gl.getUniformLocation(this.program, `u_input${i}`);
      gl.uniform1i(uInput, i);
    }

    gl.viewport(0, 0, this.resolution.width, this.resolution.height);
  }
}

// WebGL Concat4
export class WebGLConcat4 extends WebGLBaseLayer {
  constructor(e: any, t: any, n: any) {
    super(e, t, n);
    this.label = "Concat4";
  }

  vertexShader(): string {
    return `#version 300 es
        in vec2 a_position;
        in vec2 a_texCoord;
        out vec2 v_texCoord;

        void main() {
            gl_Position = vec4(a_position, 0.0, 1.0);
            v_texCoord = a_texCoord;
        }`;
  }

  fragmentShader(): string {
    return `#version 300 es
        precision highp float;

        in vec2 v_texCoord;
        out vec4 outColor;

        uniform sampler2D u_input0;
        uniform sampler2D u_input1;
        uniform sampler2D u_input2;
        uniform sampler2D u_input3;
        uniform vec2 u_inputSize;
        uniform vec4 u_bias;

        void main() {
            vec2 flippedCoord = vec2(v_texCoord.x, 1.0 - v_texCoord.y);
            ivec2 pixelCoord = ivec2(flippedCoord * u_inputSize);

            vec4 val0 = texelFetch(u_input0, pixelCoord, 0);
            vec4 val1 = texelFetch(u_input1, pixelCoord, 0);
            vec4 val2 = texelFetch(u_input2, pixelCoord, 0);
            vec4 val3 = texelFetch(u_input3, pixelCoord, 0);

            outColor = val0 + val1 + val2 + val3 + u_bias;
        }`;
  }

  setupUniforms() {
    const gl = this.gl;
    const uInputSize = gl.getUniformLocation(this.program, "u_inputSize");
    gl.uniform2f(uInputSize, this.resolution.width, this.resolution.height);
    const uBias = gl.getUniformLocation(this.program, "u_bias");
    gl.uniform4fv(uBias, new Float32Array(this.weights.bias));

    for (let i = 0; i < 4; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.inputTextures[i]);
      const uInput = gl.getUniformLocation(this.program, `u_input${i}`);
      gl.uniform1i(uInput, i);
    }

    gl.viewport(0, 0, this.resolution.width, this.resolution.height);
  }
}

// WebGL Base Network
export class WebGLBaseNetwork {
  weights: any;
  context: WebGLContext;
  layers: any[];

  constructor(weights: any) {
    this.weights = weights;
    this.context = (globalThis as any).context;
    this.layers = this.model();
  }

  model(): any[] {
    return [];
  }

  lastLayer() {
    return this.layers[this.layers.length - 1];
  }

  async feedForward(source?: any): Promise<void> {
    if (source) {
      const bitmap = source instanceof ImageBitmap ? source : await createImageBitmap(source);
      this.context.input = this.context.createTextureFromImage("input", bitmap);
      if (this.layers.length > 0) {
        this.layers[0].inputTextures[0] = this.context.input;
      }
    }
    this.layers.forEach((layer) => {
      layer.run();
    });
  }
}

// WebGL Renderer
export class WebGLRenderer {
  context: WebGLContext;
  network: WebGLBaseNetwork;
  flipY: boolean;
  tiles: any[];
  downscaleLayer: WebGLBicubicDownscale;
  passthrough: WebGLPassthrough;
  fullInputFBO: WebGLFramebuffer;
  tileInputFBO: WebGLFramebuffer;
  tileOutputFBO: WebGLFramebuffer;
  stitchTargetFBO: WebGLFramebuffer;

  constructor(network: WebGLBaseNetwork, flipY = false) {
    this.context = (globalThis as any).context;
    this.network = network;
    this.flipY = flipY;
    this.tiles = this.calculateTileGrid();
    if (this.needsDownscale()) {
      const scale = this.context.scale;
      const w = this.context.canvasResolution.width * scale;
      const h = this.context.canvasResolution.height * scale;
      const intermediate = this.context.texture("upscaled_intermediate", {
        width: w,
        height: h,
        format: this.context.gl.RGBA
      });
      this.downscaleLayer = new WebGLBicubicDownscale(intermediate, w, h, flipY);
      this.downscaleLayer.defaultSetup();
    }
    console.log(`[WebGL Upscaler]: Configuring with ${this.tiles.length} tile(s)`);
  }

  setFlipY(e: boolean) {
    this.flipY = e;
    if (this.passthrough) this.passthrough.flipY = e;
    if (this.downscaleLayer) this.downscaleLayer.flipY = e;
  }

  needsDownscale(): boolean {
    const scale = this.context.scale;
    const outputRes = this.context.outputResolution;
    return outputRes.width !== this.context.canvasResolution.width * scale || outputRes.height !== this.context.canvasResolution.height * scale;
  }

  isTiling(): boolean {
    return this.tiles.length > 1;
  }

  calculateTileGrid(): any[] {
    const grid = [];
    const tileW = this.context.processResolution.width;
    const tileH = this.context.processResolution.height;
    const srcW = this.context.canvasResolution.width;
    const srcH = this.context.canvasResolution.height;
    for (let y = 0; y < srcH; y += tileH) {
      for (let x = 0; x < srcW; x += tileW) {
        grid.push({
          srcX: x,
          srcY: y,
          dstX: x,
          dstY: y,
          width: Math.min(tileW, srcW - x),
          height: Math.min(tileH, srcH - y)
        });
      }
    }
    return grid;
  }

  async render(source: any): Promise<void> {
    if (this.isTiling()) {
      await this.renderTiled(source);
    } else {
      await this.renderSingle(source);
    }
    if (this.downscaleLayer) {
      this.downscaleLayer.run();
    }
  }

  async renderSingle(source: any): Promise<void> {
    const bitmap = source instanceof ImageBitmap ? source : await createImageBitmap(source);
    await this.network.feedForward(bitmap);
    const outputTex = this.context.textures.output;
    if (this.downscaleLayer) {
      this.blitToIntermediate(outputTex);
    } else {
      if (!this.passthrough) {
        this.passthrough = new WebGLPassthrough(outputTex, this.flipY);
        this.passthrough.defaultSetup();
      }
      this.passthrough.inputTextures[0] = outputTex;
      this.passthrough.run();
    }
  }

  async renderTiled(source: any): Promise<void> {
    const gl = this.context.gl;
    const n = this.context.scale;
    const bitmap = source instanceof ImageBitmap ? source : await createImageBitmap(source);
    const srcW = this.context.canvasResolution.width;
    const srcH = this.context.canvasResolution.height;
    const fullInputTex = this.context.createTextureFromSource("full_input", bitmap, srcW, srcH);

    if (!this.fullInputFBO) {
      this.fullInputFBO = gl.createFramebuffer();
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fullInputFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fullInputTex, 0);

    const tileInputTex = this.context.texture("input", { format: gl.RGBA });
    if (!this.tileInputFBO) {
      this.tileInputFBO = gl.createFramebuffer();
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.tileInputFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tileInputTex, 0);

    const stitchTargetTex = this.downscaleLayer
      ? this.context.textures.upscaled_intermediate
      : this.context.texture("stitched_output", { width: srcW * n, height: srcH * n, format: gl.RGBA });

    if (!this.stitchTargetFBO) {
      this.stitchTargetFBO = gl.createFramebuffer();
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.stitchTargetFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, stitchTargetTex, 0);

    if (!this.tileOutputFBO) {
      this.tileOutputFBO = gl.createFramebuffer();
    }

    for (const tile of this.tiles) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fullInputFBO);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.tileInputFBO);
      gl.blitFramebuffer(
        tile.srcX, tile.srcY, tile.srcX + tile.width, tile.srcY + tile.height,
        0, 0, tile.width, tile.height,
        gl.COLOR_BUFFER_BIT, gl.NEAREST
      );

      this.context.input = tileInputTex;
      await this.network.feedForward();

      const outputTex = this.context.textures.output;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.tileOutputFBO);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outputTex, 0);

      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.tileOutputFBO);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.stitchTargetFBO);
      gl.blitFramebuffer(
        0, 0, tile.width * n, tile.height * n,
        tile.dstX * n, tile.dstY * n, (tile.dstX + tile.width) * n, (tile.dstY + tile.height) * n,
        gl.COLOR_BUFFER_BIT, gl.NEAREST
      );
    }

    if (!this.downscaleLayer) {
      if (!this.passthrough) {
        this.passthrough = new WebGLPassthrough(stitchTargetTex, this.flipY);
        this.passthrough.defaultSetup();
      }
      this.passthrough.inputTextures[0] = stitchTargetTex;
      this.passthrough.run();
    }
  }

  cleanup() {
    const gl = this.context.gl;
    if (this.fullInputFBO) gl.deleteFramebuffer(this.fullInputFBO);
    if (this.tileInputFBO) gl.deleteFramebuffer(this.tileInputFBO);
    if (this.tileOutputFBO) gl.deleteFramebuffer(this.tileOutputFBO);
    if (this.stitchTargetFBO) gl.deleteFramebuffer(this.stitchTargetFBO);
    this.fullInputFBO = undefined;
    this.tileInputFBO = undefined;
    this.tileOutputFBO = undefined;
    this.stitchTargetFBO = undefined;
  }

  blitToIntermediate(e: WebGLTexture) {
    const gl = this.context.gl;
    const scale = this.context.scale;
    const w = this.context.canvasResolution.width * scale;
    const h = this.context.canvasResolution.height * scale;

    if (!this.tileOutputFBO) {
      this.tileOutputFBO = gl.createFramebuffer();
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.tileOutputFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, e, 0);

    if (!this.stitchTargetFBO) {
      this.stitchTargetFBO = gl.createFramebuffer();
    }
    const intermediate = this.context.textures.upscaled_intermediate;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.stitchTargetFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, intermediate, 0);

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.tileOutputFBO);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.stitchTargetFBO);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  }
}

// WebGL Anime4K CNN Large
export class WebGLAnime4KCNN2XL extends WebGLBaseNetwork {
  constructor(weights: any) {
    super(weights);
  }

  model(): any[] {
    const list: any[] = [];
    const layers = this.weights.layers;
    const ctx = this.context;
    const gl = ctx.gl;

    const inputTex = ctx.texture("input", { format: gl.RGBA });

    const conv_tf = new WebGLConv2D3x4([inputTex], ctx.texture("conv2d_tf", { format: gl.RGBA32F }), layers.conv2d_tf);
    conv_tf.framebuffer = ctx.framebuffer("conv2d_tf_fb", ["conv2d_tf"]);
    list.push(conv_tf);

    const conv_tf1 = new WebGLConv2D3x4([inputTex], ctx.texture("conv2d_tf1", { format: gl.RGBA32F }), layers.conv2d_tf1);
    conv_tf1.framebuffer = ctx.framebuffer("conv2d_tf1_fb", ["conv2d_tf1"]);
    list.push(conv_tf1);

    for (let i = 1; i < 7; i++) {
      const prevName = i === 1 ? "conv2d_tf" : `conv2d_${i - 1}_tf`;
      
      const conv_i = new WebGLConv2D16x4(
        [ctx.texture(prevName), ctx.texture(prevName + "1")],
        ctx.texture(`conv2d_${i}_tf`, { format: gl.RGBA32F }),
        layers[`conv2d_${i}_tf`]
      );
      conv_i.framebuffer = ctx.framebuffer(`conv2d_${i}_tf_fb`, [`conv2d_${i}_tf`]);
      list.push(conv_i);

      const conv_i1 = new WebGLConv2D16x4(
        [ctx.texture(prevName), ctx.texture(prevName + "1")],
        ctx.texture(`conv2d_${i}_tf1`, { format: gl.RGBA32F }),
        layers[`conv2d_${i}_tf1`]
      );
      conv_i1.framebuffer = ctx.framebuffer(`conv2d_${i}_tf1_fb`, [`conv2d_${i}_tf1`]);
      list.push(conv_i1);
    }

    for (let i = 0; i < 3; i++) {
      const inputs0 = [];
      const inputs1 = [];
      for (let j = 0; j < 7; j++) {
        const name = j === 0 ? "conv2d_tf" : `conv2d_${j}_tf`;
        inputs0.push(ctx.texture(name));
        inputs1.push(ctx.texture(name + "1"));
      }

      const lastName = i === 0 ? "conv2d_last_tf" : `conv2d_last_tf${i}`;

      const pt1 = new WebGLConv2D112x4(inputs0, ctx.texture(`conv2d_last_${i}_pt1`, { format: gl.RGBA32F }), layers[lastName], true);
      pt1.framebuffer = ctx.framebuffer(`conv2d_last_${i}_pt1_fb`, [`conv2d_last_${i}_pt1`]);
      list.push(pt1);

      const pt2 = new WebGLConv2D112x4(inputs1, ctx.texture(`conv2d_last_${i}_pt2`, { format: gl.RGBA32F }), layers[lastName], false);
      pt2.framebuffer = ctx.framebuffer(`conv2d_last_${i}_pt2_fb`, [`conv2d_last_${i}_pt2`]);
      list.push(pt2);

      const concat = new WebGLConcat2(
        [ctx.texture(`conv2d_last_${i}_pt1`), ctx.texture(`conv2d_last_${i}_pt2`)],
        ctx.texture(lastName, { format: gl.RGBA32F }),
        layers[lastName]
      );
      concat.framebuffer = ctx.framebuffer(`${lastName}_fb`, [lastName]);
      list.push(concat);
    }

    const outputTex = ctx.texture("output", {
      format: gl.RGBA,
      width: 2 * ctx.resolution.width,
      height: 2 * ctx.resolution.height
    });
    
    const display = new WebGLDisplayLayer3C(
      [ctx.texture("conv2d_last_tf"), ctx.texture("conv2d_last_tf1"), ctx.texture("conv2d_last_tf2"), inputTex],
      outputTex
    );
    display.framebuffer = ctx.framebuffer("output_fb", ["output"]);
    list.push(display);

    return list;
  }

  async feedForward(source?: any): Promise<void> {
    await super.feedForward(source);
    if (this.layers.length > 0) {
      this.layers[this.layers.length - 1].inputTextures[3] = this.context.input;
    }
    if (this.layers.length > 1) {
      this.layers[0].inputTextures[0] = this.context.input;
      this.layers[1].inputTextures[0] = this.context.input;
    }
  }
}

// WebGL Anime4K CNN 16
export class WebGLAnime4KCNN2X16 extends WebGLBaseNetwork {
  constructor(weights: any) {
    super(weights);
  }

  model(): any[] {
    const list: any[] = [];
    const layers = this.weights.layers;
    const ctx = this.context;
    const gl = ctx.gl;

    const inputTex = ctx.texture("input", { format: gl.RGBA });

    for (let i = 0; i < 4; i++) {
      const name = i === 0 ? "conv2d_tf" : `conv2d_tf${i}`;
      const conv = new WebGLConv2D3x4([inputTex], ctx.texture(name, { format: gl.RGBA32F }), layers[name]);
      conv.framebuffer = ctx.framebuffer(`${name}_fb`, [name]);
      list.push(conv);
    }

    for (let i = 1; i < 7; i++) {
      const prevName = i === 1 ? "conv2d_tf" : `conv2d_${i - 1}_tf`;
      const inputs = [];
      for (let j = 0; j < 4; j++) {
        inputs.push(ctx.texture(j === 0 ? prevName : prevName + j));
      }

      for (let j = 0; j < 4; j++) {
        const name = j === 0 ? `conv2d_${i}_tf` : `conv2d_${i}_tf${j}`;
        const conv = new WebGLConv2D32x4(inputs, ctx.texture(name, { format: gl.RGBA32F }), layers[name]);
        conv.framebuffer = ctx.framebuffer(`${name}_fb`, [name]);
        list.push(conv);
      }
    }

    for (let i = 0; i < 3; i++) {
      const inputs0 = [];
      const inputs1 = [];
      const inputs2 = [];
      const inputs3 = [];
      for (let j = 0; j < 7; j++) {
        const name = j === 0 ? "conv2d_tf" : `conv2d_${j}_tf`;
        inputs0.push(ctx.texture(name));
        inputs1.push(ctx.texture(name + "1"));
        inputs2.push(ctx.texture(name + "2"));
        inputs3.push(ctx.texture(name + "3"));
      }

      const lastName = i === 0 ? "conv2d_last_tf" : `conv2d_last_tf${i}`;

      const pt1 = new WebGLConv2D224x4(inputs0, ctx.texture(`conv2d_last_${i}_pt1`, { format: gl.RGBA32F }), layers[lastName], 0);
      pt1.framebuffer = ctx.framebuffer(`conv2d_last_${i}_pt1_fb`, [`conv2d_last_${i}_pt1`]);
      list.push(pt1);

      const pt2 = new WebGLConv2D224x4(inputs1, ctx.texture(`conv2d_last_${i}_pt2`, { format: gl.RGBA32F }), layers[lastName], 1);
      pt2.framebuffer = ctx.framebuffer(`conv2d_last_${i}_pt2_fb`, [`conv2d_last_${i}_pt2`]);
      list.push(pt2);

      const pt3 = new WebGLConv2D224x4(inputs2, ctx.texture(`conv2d_last_${i}_pt3`, { format: gl.RGBA32F }), layers[lastName], 2);
      pt3.framebuffer = ctx.framebuffer(`conv2d_last_${i}_pt3_fb`, [`conv2d_last_${i}_pt3`]);
      list.push(pt3);

      const pt4 = new WebGLConv2D224x4(inputs3, ctx.texture(`conv2d_last_${i}_pt4`, { format: gl.RGBA32F }), layers[lastName], 3);
      pt4.framebuffer = ctx.framebuffer(`conv2d_last_${i}_pt4_fb`, [`conv2d_last_${i}_pt4`]);
      list.push(pt4);

      const concat = new WebGLConcat4(
        [
          ctx.texture(`conv2d_last_${i}_pt1`),
          ctx.texture(`conv2d_last_${i}_pt2`),
          ctx.texture(`conv2d_last_${i}_pt3`),
          ctx.texture(`conv2d_last_${i}_pt4`)
        ],
        ctx.texture(lastName, { format: gl.RGBA32F }),
        layers[lastName]
      );
      concat.framebuffer = ctx.framebuffer(`${lastName}_fb`, [lastName]);
      list.push(concat);
    }

    const outputTex = ctx.texture("output", {
      format: gl.RGBA,
      width: 2 * ctx.resolution.width,
      height: 2 * ctx.resolution.height
    });

    const display = new WebGLDisplayLayer3C(
      [ctx.texture("conv2d_last_tf"), ctx.texture("conv2d_last_tf1"), ctx.texture("conv2d_last_tf2"), inputTex],
      outputTex
    );
    display.framebuffer = ctx.framebuffer("output_fb", ["output"]);
    list.push(display);

    return list;
  }

  async feedForward(source?: any): Promise<void> {
    await super.feedForward(source);
    if (this.layers.length > 0) {
      this.layers[this.layers.length - 1].inputTextures[3] = this.context.input;
    }
    if (this.layers.length > 3) {
      for (let i = 0; i < 4; i++) {
        this.layers[i].inputTextures[0] = this.context.input;
      }
    }
  }
}

// Mappings of networks
export const WebGLNetworks: { [key: string]: any } = {
  "anime4k/cnn-2x-l": WebGLAnime4KCNN2XL,
  "anime4k/cnn-2x-16": WebGLAnime4KCNN2X16
};

export const WebGLNetworkScales: { [key: string]: number } = {
  "anime4k/cnn-2x-l": 2,
  "anime4k/cnn-2x-16": 2
};

export const WebGLNetworkTilePixels: { [key: string]: number } = {
  "anime4k/cnn-2x-l": 23,
  "anime4k/cnn-2x-16": 43
};

// WebGL Upscaler class (Mirrors WebGPU WebSR)
export class WebGLUpscaler {
  initialized = false;
  params: any;
  canvas: OffscreenCanvas | HTMLCanvasElement;
  scale: number;
  tier: number;
  context: WebGLContext;
  network: WebGLBaseNetwork;
  renderer: WebGLRenderer;
  processResolution: { width: number; height: number };
  canvasResolution: { width: number; height: number };

  constructor(params: any) {
    if (!WebGLNetworks[params.network_name]) {
      throw new Error(`Network ${params.network_name} is not defined or implemented in WebGL fallback`);
    }
    this.params = params;
    this.canvas = params.canvas;
    this.scale = WebGLNetworkScales[params.network_name];
    this.tier = this.getGPUTier(params.tier);
  }

  getGPUTier(tier: any): number {
    if (!tier) return 1;
    let gpuTier = tier.tier;
    if (!gpuTier) return 1;
    if (tier.isMobile) {
      gpuTier = Math.max(gpuTier - 1, 1);
    }
    return gpuTier;
  }

  initialize() {
    var debugOpt, flipYOpt;
    if (!this.processResolution || !this.canvasResolution) {
      throw new Error("Cannot initialize without resolution");
    }
    this.params.gl.getExtension("EXT_color_buffer_float");
    
    this.context = new WebGLContext(
      this.params.gl,
      this.processResolution,
      this.canvasResolution,
      this.canvas,
      this.scale,
      this.params.debug || false,
      this.params.outputResolution
    );
    (globalThis as any).context = this.context;
    
    this.network = new WebGLNetworks[this.params.network_name](this.params.weights);
    this.network.layers.forEach((layer) => {
      layer.defaultSetup();
    });

    this.renderer = new WebGLRenderer(this.network, this.params.flipY || false);
    this.initialized = true;
  }

  static initWebGL(e?: any): any {
    let canvas;
    if (e) {
      canvas = e;
    } else if (typeof OffscreenCanvas !== "undefined") {
      canvas = new OffscreenCanvas(1024, 1024);
    } else {
      if (typeof document === "undefined") return false;
      canvas = document.createElement("canvas");
    }
    const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true });
    if (!gl) return false;
    if (!gl.getExtension("EXT_color_buffer_float")) return false;
    return gl;
  }

  static computeMaxTilePixels(networkName: string, tier = 1): number {
    const tilePixels = WebGLNetworkTilePixels[networkName] || 23;
    let budget = 100e6;
    if (tier === 3) {
      budget = 1000e6;
    } else if (tier === 2) {
      budget = 250e6;
    } else if (tier === 1) {
      budget = 100e6;
    } else {
      budget = 50e6;
    }
    return Math.floor(budget / (16 * tilePixels));
  }

  static computeOptimalGrid(W: number, H: number, maxTilePixels: number, maxDim = Infinity): { width: number; height: number } {
    if (W * H <= maxTilePixels && W <= maxDim && H <= maxDim) {
      return { width: W, height: H };
    }
    let bestCols = W;
    let bestRows = H;
    for (let cols = 1; cols <= W; cols++) {
      const tileW = Math.ceil(W / cols);
      if (tileW > maxDim) continue;
      const maxTileH = Math.min(Math.floor(maxTilePixels / tileW), maxDim);
      if (maxTileH <= 0) break;
      const rows = Math.ceil(H / maxTileH);
      const tileH = Math.ceil(H / rows);
      if (tileW * tileH <= maxTilePixels && cols * rows < bestCols * bestRows) {
        bestCols = cols;
        bestRows = rows;
      }
      if (rows === 1) break;
    }
    return {
      width: Math.ceil(W / bestCols),
      height: Math.ceil(H / bestRows)
    };
  }

  async render(source: any): Promise<void> {
    if (!source) {
      throw new Error("render() requires a source parameter");
    }
    const canvasResolution = {
      width: getSourceWidth(source),
      height: getSourceHeight(source)
    };
    if (!this.initialized) {
      const maxTilePixels = WebGLUpscaler.computeMaxTilePixels(this.params.network_name, this.tier);
      const maxTextureSize = this.params.gl.getParameter(this.params.gl.MAX_TEXTURE_SIZE);
      const maxDim = Math.floor(maxTextureSize / this.scale);
      const grid = WebGLUpscaler.computeOptimalGrid(canvasResolution.width, canvasResolution.height, maxTilePixels, maxDim);
      this.processResolution = grid;
      this.canvasResolution = canvasResolution;
      this.initialize();
    }
    await this.renderer.render(source);
  }

  readPixels(): Uint8Array {
    const gl = this.params.gl;
    const w = this.canvas.width;
    const h = this.canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  }

  cleanupAll() {
    if (this.renderer) {
      this.renderer.cleanup();
      (this.renderer as any) = undefined;
    }
    if (this.context) {
      this.context.cleanup();
      (this.context as any) = undefined;
    }
    (this.network as any) = undefined;
    this.initialized = false;
  }

  switchNetwork(networkName: string, weights: any) {
    this.params = { ...this.params, network_name: networkName, weights };
    this.scale = WebGLNetworkScales[networkName];
    this.cleanupAll();
  }

  setOutputResolution(res: any) {
    this.params = { ...this.params, outputResolution: res };
    this.cleanupAll();
  }

  setFlipY(flipY: boolean) {
    this.params = { ...this.params, flipY };
    if (this.renderer) {
      this.renderer.setFlipY(flipY);
    }
  }

  destroy() {
    this.cleanupAll();
  }
}

// WebGL Bilinear Upscaler
export class WebGLBilinearUpscaler {
  canvas: OffscreenCanvas;
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  uOutputSize: WebGLUniformLocation;
  vao: WebGLVertexArrayObject;
  cachedSource: any = null;
  cachedTexture: WebGLTexture = null;

  constructor() {
    this.canvas = new OffscreenCanvas(1, 1);
    const gl = this.canvas.getContext("webgl2");
    if (!gl) throw new Error("WebGL2 unavailable for bilinear upscaler");
    this.gl = gl;
    this.program = this._createProgram();
    this.uOutputSize = gl.getUniformLocation(this.program, "u_outputSize");
    this.vao = gl.createVertexArray();
  }

  _createProgram(): WebGLProgram {
    const gl = this.gl;
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, `#version 300 es
      void main() {
        vec2 positions[3];
        positions[0] = vec2(-1.0, -1.0);
        positions[1] = vec2( 3.0, -1.0);
        positions[2] = vec2(-1.0,  3.0);
        gl_Position = vec4(positions[gl_VertexID], 0.0, 1.0);
      }
    `);
    gl.compileShader(vs);

    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, `#version 300 es
      precision mediump float;
      uniform sampler2D u_texture;
      uniform vec2 u_outputSize;
      out vec4 fragColor;
      void main() {
        vec2 uv = vec2(gl_FragCoord.x / u_outputSize.x, 1.0 - gl_FragCoord.y / u_outputSize.y);
        fragColor = texture(u_texture, uv);
      }
    `);
    gl.compileShader(fs);

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return prog;
  }

  _ensureTexture(source: any) {
    if (source === this.cachedSource && this.cachedTexture) return;
    const gl = this.gl;
    if (this.cachedTexture) gl.deleteTexture(this.cachedTexture);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    this.cachedTexture = tex;
    this.cachedSource = source;
  }

  upscale(source: any, width: number, height: number): ImageBitmap {
    const gl = this.gl;
    const srcW = source.displayWidth ?? source.width;
    const srcH = source.displayHeight ?? source.height;
    console.log(`[WebGL Bilinear]: Upscaling ${srcW}x${srcH} → ${width}x${height}`);
    this._ensureTexture(source);
    this.canvas.width = width;
    this.canvas.height = height;
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.bindTexture(gl.TEXTURE_2D, this.cachedTexture);
    gl.uniform2f(this.uOutputSize, width, height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    console.log("[WebGL Bilinear]: Done");
    return this.canvas.transferToImageBitmap();
  }

  destroy() {
    const gl = this.gl;
    if (this.cachedTexture) gl.deleteTexture(this.cachedTexture);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

// WebGPU Bilinear Upscaler
export class WebGPUBilinearUpscaler {
  device: GPUDevice;
  sampler: GPUSampler;
  format: GPUTextureFormat;
  pipeline: GPURenderPipeline;

  constructor(device: GPUDevice) {
    this.device = device;
    this.sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge"
    });
    const shader = device.createShaderModule({
      code: `
        @group(0) @binding(0) var sourceTex: texture_2d<f32>;
        @group(0) @binding(1) var sourceSampler: sampler;

        struct VertexOut {
          @builtin(position) pos: vec4<f32>,
          @location(0) uv: vec2<f32>,
        }

        @vertex fn vs(@builtin(vertex_index) vi: u32) -> VertexOut {
          var positions = array<vec2<f32>, 3>(
            vec2(-1.0, -1.0),
            vec2( 3.0, -1.0),
            vec2(-1.0,  3.0)
          );
          var uvs = array<vec2<f32>, 3>(
            vec2(0.0,  1.0),
            vec2(2.0,  1.0),
            vec2(0.0, -1.0)
          );
          var out: VertexOut;
          out.pos = vec4(positions[vi], 0.0, 1.0);
          out.uv = uvs[vi];
          return out;
        }

        @fragment fn fs(in: VertexOut) -> @location(0) vec4<f32> {
          return textureSample(sourceTex, sourceSampler, in.uv);
        }
      `
    });
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: shader, entryPoint: "vs" },
      fragment: { module: shader, entryPoint: "fs", targets: [{ format: this.format }] },
      primitive: { topology: "triangle-list" }
    });
  }

  async upscale(source: any, width: number, height: number): Promise<ImageBitmap> {
    const { device } = this;
    const srcW = source.displayWidth ?? source.width;
    const srcH = source.displayHeight ?? source.height;
    console.log(`[WebGPU Bilinear]: Upscaling ${srcW}x${srcH} → ${width}x${height}`);
    const tex = device.createTexture({
      size: [srcW, srcH],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    });
    device.queue.copyExternalImageToTexture({ source }, { texture: tex }, [srcW, srcH]);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("webgpu") as any;
    ctx.configure({ device, format: this.format, alphaMode: "opaque" });
    const bg = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: tex.createView() },
        { binding: 1, resource: this.sampler }
      ]
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: ctx.getCurrentTexture().createView(),
        loadOp: "clear",
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        storeOp: "store"
      }]
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bg);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    console.log("[WebGPU Bilinear]: Done");
    const bitmap = canvas.transferToImageBitmap();
    tex.destroy();
    return bitmap;
  }
}
