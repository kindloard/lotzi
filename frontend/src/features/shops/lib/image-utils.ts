interface CloudinaryOptions {
  width?: number;
  height?: number;
  quality?: "auto" | number;
  format?: "auto" | "webp" | "avif";
  crop?: "fill" | "limit" | "scale" | "crop";
  gravity?: "auto" | "center";
  blur?: boolean;
  trim?: boolean | number;
}

const CLOUDINARY_UPLOAD_MARKER = "/image/upload/";

export function optimizedCloudinaryUrl(url: string | null | undefined, options: CloudinaryOptions = {}) {
  if (!url || !url.includes("res.cloudinary.com") || !url.includes(CLOUDINARY_UPLOAD_MARKER)) {
    return url ?? null;
  }

  const transformChain = buildTransformChain(options);
  if (!transformChain.length) {
    return url;
  }

  const [prefix, suffix] = url.split(CLOUDINARY_UPLOAD_MARKER);
  return `${prefix}${CLOUDINARY_UPLOAD_MARKER}${transformChain.join("/")}/${suffix}`;
}

export function blurDataUrl(color = "#f1f5f9") {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="10" viewBox="0 0 16 10"><rect width="16" height="10" fill="${color}"/><path d="M0 8L4 4L7 7L10 3L16 8V10H0Z" fill="#e2e8f0"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function buildTransformChain(options: CloudinaryOptions) {
  const chain: string[] = [];

  if (options.trim) {
    chain.push(typeof options.trim === "number" ? `e_trim:${options.trim}` : "e_trim");
  }

  const transforms: string[] = [];

  if (options.format ?? "auto") {
    transforms.push(`f_${options.format ?? "auto"}`);
  }

  const quality = options.quality ?? "auto";
  transforms.push(typeof quality === "number" ? `q_${quality}` : "q_auto:good");

  if (options.crop) {
    transforms.push(`c_${options.crop}`);
  }

  if (options.gravity) {
    transforms.push(`g_${options.gravity}`);
  }

  if (options.width) {
    transforms.push(`w_${options.width}`);
  }

  if (options.height) {
    transforms.push(`h_${options.height}`);
  }

  if (options.blur) {
    transforms.push("e_blur:1000");
  }

  if (transforms.length) {
    chain.push(transforms.join(","));
  }

  return chain;
}
