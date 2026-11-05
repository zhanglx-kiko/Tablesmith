import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { saveExport, type SaveResult } from './fileService';

/**
 * Capture an HTML container and save it as an A4 PDF document.
 */
export async function exportReportToPdf(
  element: HTMLElement,
  fileName: string = 'Tablesmith-Report',
  targetDirectory?: string,
): Promise<SaveResult> {
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

  const bytes = new Uint8Array(pdf.output('arraybuffer'));
  return saveExport(`${fileName}.pdf`, bytes, { name: 'PDF Document', extensions: ['pdf'] }, targetDirectory);
}

/**
 * Open the system print dialog (which can also save as a vector PDF).
 */
export function printReport(): void {
  window.print();
}
