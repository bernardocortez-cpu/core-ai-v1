import { useCallback, useEffect, useRef, useState } from "react";

function transferHasFiles(dataTransfer) {
  if (!dataTransfer) return false;

  const types = Array.isArray(dataTransfer.types) ? dataTransfer.types : Array.from(dataTransfer.types || []);
  if (types.includes("Files")) return true;

  const items = Array.isArray(dataTransfer.items) ? dataTransfer.items : Array.from(dataTransfer.items || []);
  return items.some((item) => item?.kind === "file");
}

function dedupeFiles(files) {
  const seen = new Set();

  return files.filter((file) => {
    if (!(file instanceof File)) return false;

    const key = [file.name, file.size, file.lastModified, file.type].join("::");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isDirectoryPlaceholderFile(file) {
  return file instanceof File && file.size === 0 && !file.type;
}

function readFileEntry(entry) {
  return new Promise((resolve) => {
    try {
      entry.file(
        (file) => resolve(file || null),
        () => resolve(null)
      );
    } catch {
      resolve(null);
    }
  });
}

function readDirectoryBatch(reader) {
  return new Promise((resolve) => {
    try {
      reader.readEntries(
        (entries) => resolve(Array.from(entries || [])),
        () => resolve([])
      );
    } catch {
      resolve([]);
    }
  });
}

async function readAllDirectoryEntries(reader) {
  const entries = [];

  while (true) {
    const batch = await readDirectoryBatch(reader);
    if (batch.length === 0) break;
    entries.push(...batch);
  }

  return entries;
}

async function getFilesFromEntry(entry) {
  if (!entry) return [];

  if (entry.isFile) {
    const file = await readFileEntry(entry);
    return file ? [file] : [];
  }

  if (entry.isDirectory) {
    const reader = typeof entry.createReader === "function" ? entry.createReader() : null;
    if (!reader) return [];

    const childEntries = await readAllDirectoryEntries(reader);
    const nestedFiles = await Promise.all(childEntries.map((childEntry) => getFilesFromEntry(childEntry)));
    return nestedFiles.flat();
  }

  return [];
}

async function getFilesFromHandle(handle) {
  if (!handle) return [];

  if (handle.kind === "file") {
    try {
      const file = await handle.getFile();
      return file ? [file] : [];
    } catch {
      return [];
    }
  }

  if (handle.kind === "directory") {
    const files = [];

    try {
      for await (const childHandle of handle.values()) {
        files.push(...(await getFilesFromHandle(childHandle)));
      }
    } catch {
      return [];
    }

    return files;
  }

  return [];
}

export async function extractTransferFiles(dataTransfer) {
  const items = Array.isArray(dataTransfer?.items)
    ? dataTransfer.items
    : Array.from(dataTransfer?.items || []);

  const fileItems = Array.from(items || []).filter((item) => item?.kind === "file");
  let extractedFiles = [];
  let sawDirectoryDrop = false;

  for (const item of fileItems) {
    if (typeof item.getAsFileSystemHandle === "function") {
      try {
        const handle = await item.getAsFileSystemHandle();
        if (handle) {
          if (handle.kind === "directory") sawDirectoryDrop = true;
          extractedFiles.push(...(await getFilesFromHandle(handle)));
          continue;
        }
      } catch {
        // fall through to other browser-specific APIs
      }
    }

    if (typeof item.webkitGetAsEntry === "function") {
      try {
        const entry = item.webkitGetAsEntry();
        if (entry) {
          if (entry.isDirectory) sawDirectoryDrop = true;
          extractedFiles.push(...(await getFilesFromEntry(entry)));
          continue;
        }
      } catch {
        // fall through to plain file extraction
      }
    }

    const file = typeof item.getAsFile === "function" ? item.getAsFile() : null;
    if (file) extractedFiles.push(file);
  }

  if (extractedFiles.length > 0) {
    return dedupeFiles(extractedFiles);
  }

  const fallbackFiles = Array.from(dataTransfer?.files || []);
  if (!sawDirectoryDrop) return fallbackFiles;

  return fallbackFiles.filter((file) => !isDirectoryPlaceholderFile(file));
}

export default function useFileDropTarget({ onFiles, disabled = false } = {}) {
  const [isDragActive, setIsDragActive] = useState(false);
  const dragDepthRef = useRef(0);

  const reset = useCallback(() => {
    dragDepthRef.current = 0;
    setIsDragActive(false);
  }, []);

  useEffect(() => {
    if (disabled) reset();
  }, [disabled, reset]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handleWindowDrop = () => reset();
    const handleWindowDragEnd = () => reset();

    window.addEventListener("drop", handleWindowDrop);
    window.addEventListener("dragend", handleWindowDragEnd);

    return () => {
      window.removeEventListener("drop", handleWindowDrop);
      window.removeEventListener("dragend", handleWindowDragEnd);
    };
  }, [reset]);

  const onDragEnter = useCallback(
    (event) => {
      if (disabled || !transferHasFiles(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current += 1;
      setIsDragActive(true);
    },
    [disabled]
  );

  const onDragOver = useCallback(
    (event) => {
      if (disabled || !transferHasFiles(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      if (!isDragActive) setIsDragActive(true);
    },
    [disabled, isDragActive]
  );

  const onDragLeave = useCallback(
    (event) => {
      if (disabled || !transferHasFiles(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setIsDragActive(false);
    },
    [disabled]
  );

  const onDrop = useCallback(
    async (event) => {
      if (disabled || !transferHasFiles(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();

      const dataTransfer = event.dataTransfer;
      reset();

      if (!dataTransfer || typeof onFiles !== "function") return;

      const files = await extractTransferFiles(dataTransfer);
      if (files.length > 0) {
        onFiles(files);
      }
    },
    [disabled, onFiles, reset]
  );

  return {
    isDragActive,
    dropTargetProps: {
      onDragEnter,
      onDragOver,
      onDragLeave,
      onDrop,
    },
  };
}
