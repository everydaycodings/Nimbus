"use client";

import { useState, useRef, useMemo } from "react";
import {
  CloudArrowUp,
  FileArrowDown,
  Trash,
  FileText,
  ClockAfternoon,
  ArrowSquareOut,
  FolderSimplePlus,
  FolderOpen,
  Folder,
  DotsThreeVertical,
  ArrowLeft,
} from "@phosphor-icons/react";
import { useOfflineVault } from "../hooks/useOfflineVault";
import Breadcrumbs from "./Breadcrumbs";
import { ShieldCheck as ShieldCheckIcon, CaretRight } from "@phosphor-icons/react";

const TEAL = "#2da07a";

export default function LocalFileExplorer() {
  const { files, uploadFile, uploadFolder, createFolder, downloadFile, deleteItem, lockVault, activeVaultName, isLoading } = useOfflineVault();
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const currentFiles = useMemo(() => {
    return files.filter(f => f.parentId === currentFolderId);
  }, [files, currentFolderId]);

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "—";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const handleNewFolder = async () => {
    const name = prompt("Folder name:");
    if (name) await createFolder(name, currentFolderId);
  };

  return (
    <div className="flex flex-col h-full bg-background/30 animate-in slide-in-from-bottom-5 duration-700">
      {/* Header / Actions */}
      <div className="flex flex-col gap-4 p-8 border-b bg-card/40 backdrop-blur-3xl sticky top-0 z-20 shadow-sm border-border/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
               onClick={lockVault}
               className="p-3 bg-secondary/50 rounded-2xl hover:bg-accent transition-all text-muted-foreground group"
               title="Back to Vault Selector"
            >
               <ArrowLeft size={18} weight="bold" className="group-hover:-translate-x-0.5 transition-transform" />
            </button>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-foreground/90 uppercase">{activeVaultName}</h1>
              <p className="text-[10px] text-muted-foreground font-bold tracking-widest flex items-center gap-1.5 opacity-60">
                <FolderOpen size={12} weight="fill" />
                SECURE LOCAL CONTAINER
              </p>
            </div>
          </div>

          <div className="flex gap-2.5">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && uploadFile(e.target.files[0], currentFolderId)}
            />
            <input
              ref={folderInputRef}
              type="file"
              // @ts-ignore
              webkitdirectory=""
              className="hidden"
              onChange={(e) => e.target.files && uploadFolder(e.target.files)}
            />

            <button
              onClick={handleNewFolder}
              className="px-5 py-2.5 bg-secondary/60 text-secondary-foreground rounded-2xl text-xs font-bold hover:bg-accent transition-all border border-border/40 flex items-center gap-2 active:scale-95"
            >
              <FolderSimplePlus size={16} weight="bold" style={{ color: TEAL }} />
              New Folder
            </button>
            
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              className="flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground rounded-2xl text-xs font-bold hover:opacity-90 transition-all shadow-xl shadow-primary/20 active:scale-95 disabled:opacity-50"
              style={{ backgroundColor: TEAL }}
            >
              <CloudArrowUp size={18} weight="bold" />
              Upload Files
            </button>
            
             <button
              onClick={() => folderInputRef.current?.click()}
              disabled={isLoading}
              className="px-3 bg-secondary/60 text-secondary-foreground rounded-2xl hover:bg-accent transition-all border border-border/40 active:scale-95 flex items-center justify-center p-2.5"
              title="Upload entire folder"
            >
              <Folder size={18} weight="bold" />
            </button>
          </div>
        </div>

        <Breadcrumbs currentFolderId={currentFolderId} setCurrentFolderId={setCurrentFolderId} />
      </div>

      {/* File List */}
      <div className="flex-1 overflow-y-auto p-8 pt-6">
        {currentFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-40 text-center opacity-30 select-none animate-in fade-in zoom-in-95 duration-1000">
            <div className="w-24 h-24 rounded-[2rem] bg-secondary flex items-center justify-center mb-8 border border-border/50">
               <FileText size={48} weight="thin" />
            </div>
            <h3 className="text-xl font-bold">This folder is empty</h3>
            <p className="text-xs mt-2 uppercase tracking-widest font-bold font-mono">End-to-end Local Encryption Active</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {currentFiles.sort((a, b) => (a.type === 'folder' ? -1 : 1)).map((item) => (
              <div
                key={item.id}
                onClick={item.type === 'folder' ? () => setCurrentFolderId(item.id) : undefined}
                className={`group relative flex flex-col p-5 bg-card/30 backdrop-blur-sm border border-border/50 rounded-[2rem] hover:border-primary/40 transition-all duration-300 shadow-sm hover:shadow-xl h-[180px] ${item.type === 'folder' ? 'cursor-pointer' : ''}`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110 ${item.type === 'folder' ? 'bg-primary/5' : 'bg-secondary/50'}`}>
                    {item.type === 'folder' ? (
                      <Folder size={24} weight="fill" style={{ color: TEAL }} />
                    ) : (
                      <FileText size={24} weight="fill" style={{ color: TEAL }} />
                    )}
                  </div>
                  
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); item.type === 'file' && downloadFile(item); }}
                      className={`p-2 rounded-xl bg-background/50 hover:bg-secondary text-primary transition-all border border-border/40 ${item.type === 'folder' ? 'hidden' : ''}`}
                    >
                      <FileArrowDown size={18} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); if (confirm('Permanently delete?')) deleteItem(item); }}
                      className="p-2 rounded-xl bg-background/50 hover:bg-red-500/10 text-red-500 transition-all border border-border/40"
                    >
                      <Trash size={18} />
                    </button>
                  </div>
                </div>

                <div className="mt-auto">
                  <h3 className="text-sm font-bold truncate pr-6 text-foreground/90 group-hover:text-primary transition-colors" style={item.type === 'folder' ? {} : {}}>
                    {item.name}
                  </h3>
                  <div className="flex items-center gap-3 mt-2">
                     <span className="text-[10px] uppercase font-bold tracking-tighter opacity-40">
                        {item.type === 'folder' ? 'Folder' : formatSize(item.size)}
                     </span>
                     <span className="text-[10px] text-muted-foreground flex items-center gap-1 opacity-40 font-bold">
                        <ClockAfternoon size={12} />
                        {new Date(item.lastModified).toLocaleDateString()}
                     </span>
                  </div>
                </div>
                
                {item.type === 'folder' && (
                   <div className="absolute bottom-5 right-5 opacity-0 group-hover:opacity-60 transition-opacity">
                      <CaretRight size={14} weight="bold" />
                   </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

       {/* Footer info Bar */}
       <div className="px-8 py-4 border-t bg-card/20 backdrop-blur-3xl flex justify-between items-center text-[10px] font-bold tracking-[0.2em] text-muted-foreground uppercase opacity-60 sticky bottom-0">
          <div className="flex items-center gap-3">
             <ShieldCheck size={16} style={{ color: TEAL }} weight="fill" />
             Zero-Knowledge local safe active
          </div>
          <div className="flex items-center gap-6">
             <span>AES-256-GCM</span>
             <span>CLIENT-SIDE ONLY</span>
          </div>
       </div>
    </div>
  );
}

function ShieldCheck({ size, style, className, weight }: any) {
  return <ShieldCheckIcon size={size} style={style} className={className} weight={weight} />;
}
