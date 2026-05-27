/* eslint-disable @next/next/no-img-element */
import { ChangeEvent, DragEvent } from "react";
import { CloudUpload, Loader2 } from "lucide-react";
import { UploadState } from "../../hooks/useOnboarding";

interface UploadZoneProps {
  error?: string;
  kind: "LOGO" | "BANNER";
  label: string;
  onFile: (kind: "LOGO" | "BANNER", file: File) => void;
  previewUrl: string;
  state: UploadState[keyof UploadState];
}

export function UploadZone({ error, kind, label, onFile, previewUrl, state }: UploadZoneProps) {
  const inputId = `upload-${kind.toLowerCase()}`;
  
  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) {
      onFile(kind, file);
    }
  };
  
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    handleFiles(event.dataTransfer.files);
  };

  const isError = Boolean(error) || state === "error";
  const isUploading = state === "uploading";
  const isLogo = kind === "LOGO";

  return (
    <label className="block w-full cursor-pointer group" htmlFor={inputId}>
      <span className="text-[13px] font-semibold text-zinc-900 tracking-tight block mb-1.5">{label}</span>
      <div
        className={`
          relative flex h-[180px] w-full flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed p-4 text-center
          transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]
          ${isError 
            ? "border-red-300 bg-red-50/50" 
            : "border-zinc-200 bg-zinc-50/50 group-hover:border-zinc-900 group-hover:bg-zinc-50/80"
          }
        `}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      >
        {previewUrl ? (
          <div className={`absolute inset-0 p-2 ${isLogo ? "bg-white" : ""}`}>
            <img 
              alt={`${label} preview`} 
              className={`h-full w-full rounded-lg shadow-sm transition-transform duration-500 group-hover:scale-[1.02] ${isLogo ? "object-contain" : "object-cover"}`} 
              src={previewUrl} 
            />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center rounded-lg m-2">
               <span className="text-white text-sm font-semibold tracking-tight backdrop-blur-md bg-white/20 px-3 py-1.5 rounded-md">Replace image</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center z-10">
            <div className={`
              mb-4 flex size-12 items-center justify-center rounded-full bg-white shadow-sm border border-zinc-100
              transition-transform duration-300 group-hover:scale-110
              ${isUploading ? "animate-pulse" : ""}
            `}>
              <CloudUpload className="text-zinc-900" size={24} strokeWidth={1.5} />
            </div>
            <span className="text-sm font-semibold text-zinc-900">
              {isUploading ? "Uploading..." : "Click or drag & drop"}
            </span>
            <span className="mt-1 text-xs font-medium text-zinc-500">
              PNG, JPG, or WebP
            </span>
            {isUploading && <Loader2 className="mt-3 animate-spin text-zinc-900" size={18} />}
          </div>
        )}
        <input
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          disabled={isUploading}
          id={inputId}
          onChange={(event: ChangeEvent<HTMLInputElement>) => handleFiles(event.target.files)}
          type="file"
        />
      </div>
      {error && (
        <span className="mt-2 block text-xs font-medium text-red-600 animate-in fade-in slide-in-from-top-1">
          {error}
        </span>
      )}
    </label>
  );
}
