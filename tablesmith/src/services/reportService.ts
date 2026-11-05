import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { isTauriEnv, getLastExportDir, setLastExportDir, getUniqueFilePath } from './fileService';

/**
 * Capture an HTML container and download it as an A4 PDF document.
 */
export async function exportReportToPdf(
  element: HTMLElement,
  fileName: string = 'Tablesmith-Report',
  targetDirectory?: string,
): Promise<{ saved: boolean; fileName: string; path?: string }> {
  const canvas = await html2canvas(element, {
    scale: 2, // High resolution (retina)
    useCORS: true,
    logging: false,
    backgroundColor: '#ffffff',
  });

  const imgData = canvas.toDataURL('image/png');
  const pdf = new jsPDF('p', 'mm', 'a4');
  const pdfWidth = pdf.internal.pageSize.getWidth();
  const a4Height = pdf.internal.pageSize.getHeight();
  const calculatedHeight = (canvas.height * pdfWidth) / canvas.width;

  // Single page or multi-page support
  if (calculatedHeight <= a4Height) {
    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, calculatedHeight);
  } else {
    let heightLeft = calculatedHeight;
    let position = 0;

    pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, calculatedHeight);
    heightLeft -= a4Height;

    while (heightLeft > 0) {
      position = position - a4Height;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, calculatedHeight);
      heightLeft -= a4Height;
    }
  }

  const fullFileName = `${fileName}.pdf`;

  if (isTauriEnv()) {
    let savePath = '';
    const resolvedDir = (targetDirectory && targetDirectory.trim()) || getLastExportDir();

    if (resolvedDir) {
      savePath = `${resolvedDir.replace(/[\\/]+$/, '')}\\${fullFileName}`;
    } else {
      const picked = await save({
        defaultPath: fullFileName,
        filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
      });
      if (!picked) return { saved: false, fileName: fullFileName };
      savePath = picked;
    }

    // Safeguard: auto-number with (1), (2) if the file already exists in destination
    savePath = await getUniqueFilePath(savePath);

    const arrayBuffer = pdf.output('arraybuffer');
    await invoke('save_binary_file', {
      path: savePath,
      data: Array.from(new Uint8Array(arrayBuffer)),
    });

    const lastSlash = Math.max(savePath.lastIndexOf('\\'), savePath.lastIndexOf('/'));
    if (lastSlash > 0) {
      setLastExportDir(savePath.substring(0, lastSlash));
    }

    const actualFileName = savePath.substring(lastSlash + 1) || fullFileName;
    return { saved: true, fileName: actualFileName, path: savePath };
  }

  pdf.save(fullFileName);
  return { saved: true, fileName: fullFileName };
}

/**
 * Trigger native browser print dialog (which allows saving as vector PDF).
 */
export function printReport(): void {
  window.print();
}
