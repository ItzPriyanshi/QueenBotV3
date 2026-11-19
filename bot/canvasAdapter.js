const Module = require("module");
const { Readable } = require("stream");

let napi;
try {
  napi = require("@napi-rs/canvas");
} catch (_) {
  napi = null;
}

let canvasAdapter = null;

if (napi) {
  if (napi.CanvasElement && !napi.CanvasElement.prototype.__queenPatched) {
    const origToBuffer = napi.CanvasElement.prototype.toBuffer;
    napi.CanvasElement.prototype.toBuffer = function (mime, ...args) {
      return origToBuffer.call(this, mime || "image/png", ...args);
    };
    napi.CanvasElement.prototype.createPNGStream = function () {
      return Readable.from(this.toBuffer("image/png"));
    };
    napi.CanvasElement.prototype.__queenPatched = true;
  }

  const registerFont = function (src, fontFace) {
    try {
      return napi.GlobalFonts.registerFromPath(src, fontFace && fontFace.family ? fontFace.family : undefined);
    } catch (_) {
      return false;
    }
  };

  const deregisterAllFonts = function () {
    return true;
  };

  const createCanvas = function (width, height, type) {
    return napi.createCanvas(width, height);
  };

  const loadImage = function (src) {
    return napi.loadImage(src);
  };

  const createImageData = function (array, width, height) {
    return new napi.ImageData(array, width, height);
  };

  const Canvas = napi.Canvas || napi.CanvasElement;
  if (Canvas) {
    Canvas.registerFont = registerFont;
    Canvas.deregisterAllFonts = deregisterAllFonts;
    Canvas.loadImage = loadImage;
    Canvas.createCanvas = createCanvas;
  }

  canvasAdapter = {
    Canvas: Canvas,
    Context2d: napi.CanvasRenderingContext2D,
    CanvasRenderingContext2D: napi.CanvasRenderingContext2D,
    CanvasGradient: napi.CanvasGradient || function () {},
    CanvasPattern: napi.CanvasPattern || function () {},
    Image: napi.Image,
    ImageData: napi.ImageData,
    PNGStream: Readable,
    PDFStream: Readable,
    JPEGStream: Readable,
    DOMMatrix: napi.DOMMatrix,
    DOMPoint: napi.DOMPoint,
    registerFont: registerFont,
    deregisterAllFonts: deregisterAllFonts,
    createCanvas: createCanvas,
    createImageData: createImageData,
    loadImage: loadImage,
    version: "2.11.2",
    cairoVersion: "1.16.0",
    jpegVersion: "8",
    gifVersion: "5.2.1",
    freetypeVersion: "2.11.1",
    rsvgVersion: "2.52.5",
    pangoVersion: "1.50.6"
  };
}

if (canvasAdapter && Module && Module._load) {
  const origModuleLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (
      request === "canvas" ||
      request.includes("node_modules/canvas") ||
      request.includes("node_modules\\canvas") ||
      request.includes("canvas/lib/bindings") ||
      request.includes("canvas\\lib\\bindings")
    ) {
      return canvasAdapter;
    }
    return origModuleLoad.apply(this, arguments);
  };
}

module.exports = canvasAdapter;
