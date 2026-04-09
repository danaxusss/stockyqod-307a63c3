// @ts-nocheck
import { Quote, QuoteItem, QuoteTemplate } from '../types';
import * as ExcelJS from 'exceljs';

export class ExcelExportService {
  // Generate quote number in format QT-YYYYMMDD-XXXX
  static generateQuoteNumber(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    
    // Use alphanumeric random string for better uniqueness
    const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    
    return `QT-${year}${month}${day}-${randomSuffix}`;
  }

  // Format date as DD/MM/YYYY
  static formatDate(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    
    return `${day}/${month}/${year}`;
  }

  // Format currency with thousand separators
  static formatCurrency(amount: number): string {
    return new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  }

  // Calculate totals (HT, TVA 20%, TTC)
  static calculateTotals(totalAmount: number): { ht: number; tva: number; ttc: number } {
    // totalAmount is already TTC (includes VAT), so we need to calculate backwards
    const ttc = totalAmount;
    const ht = ttc / 1.20; // Calculate HT by dividing TTC by 1.20 (since TTC = HT * 1.20)
    const tva = ttc - ht; // TVA is the difference between TTC and HT
    
    return { ht, tva, ttc };
  }

  // Validate Excel template structure
  static validateTemplate(file: File): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = async (e) => {
        try {
          const buffer = e.target?.result as ArrayBuffer;
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(buffer);
          
          // Check if workbook has at least one worksheet
          if (workbook.worksheets.length === 0) {
            reject(new Error('Le fichier Excel ne contient aucune feuille'));
            return;
          }

          resolve(true);
        } catch (error) {
          reject(new Error('Format de fichier Excel invalide'));
        }
      };

      reader.onerror = () => {
        reject(new Error('Erreur lors de la lecture du fichier'));
      };

      reader.readAsArrayBuffer(file);
    });
  }

  // Export quote to Excel using template with ExcelJS (preserves formatting)
  static async exportQuoteToExcel(
    quote: Quote, 
    template?: QuoteTemplate,
    forceDefaultTemplate: boolean = false
  ): Promise<void> {
    try {
      let workbook: ExcelJS.Workbook;

      if (template && !forceDefaultTemplate) {
        console.log('Using provided template with ExcelJS:', template.name);
        try {
          // Load template with ExcelJS (preserves formatting)
          workbook = new ExcelJS.Workbook();
          const buffer = new Uint8Array(template.fileData);
          await workbook.xlsx.load(buffer);
          
          // Validate that the template has at least one worksheet
          if (workbook.worksheets.length === 0) {
            console.warn('Template has no worksheets, falling back to default');
            workbook = await this.createDefaultTemplateWithExcelJS();
          }
        } catch (error) {
          console.error('Failed to load template with ExcelJS, using default:', error);
          workbook = await this.createDefaultTemplateWithExcelJS();
        }
      } else {
        console.log('Using default template with ExcelJS');
        workbook = await this.createDefaultTemplateWithExcelJS();
      }

      // Handle pagination - max 40 items per sheet
      const ITEMS_PER_SHEET = 40;
      const totalSheets = Math.ceil(quote.items.length / ITEMS_PER_SHEET);

      for (let sheetIndex = 0; sheetIndex < totalSheets; sheetIndex++) {
        const startIndex = sheetIndex * ITEMS_PER_SHEET;
        const endIndex = Math.min(startIndex + ITEMS_PER_SHEET, quote.items.length);
        const sheetItems = quote.items.slice(startIndex, endIndex);

        let worksheet: ExcelJS.Worksheet;

        if (sheetIndex === 0) {
          // Use the first existing worksheet
          worksheet = workbook.worksheets[0];
        } else {
          // Clone the template for additional sheets
          const templateSheet = workbook.worksheets[0];
          worksheet = workbook.addWorksheet(`Devis_Page_${sheetIndex + 1}`);
          
          // Copy structure from template (this preserves some formatting)
          templateSheet.eachRow((row, rowNumber) => {
            const newRow = worksheet.getRow(rowNumber);
            row.eachCell((cell, colNumber) => {
              const newCell = newRow.getCell(colNumber);
              
              // Copy cell value and basic formatting
              newCell.value = cell.value;
              if (cell.style) {
                newCell.style = { ...cell.style };
              }
            });
            newRow.commit();
          });
        }

        // Populate the worksheet with quote data
        await this.populateWorksheetWithExcelJS(worksheet, quote, sheetItems, sheetIndex + 1, totalSheets);
      }

      // Generate filename
      const filename = `Devis_${quote.quoteNumber}_${this.formatDate(quote.createdAt).replace(/\//g, '-')}.xlsx`;

      // Export file using ExcelJS
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { 
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
      });
      
      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      console.log('Quote exported successfully with ExcelJS:', filename);
    } catch (error) {
      console.error('Export failed:', error);
      throw new Error(`Échec de l'export Excel: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
    }
  }

  // Create default Excel template with ExcelJS (with basic formatting)
  private static async createDefaultTemplateWithExcelJS(): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Devis');
    
    // Set column widths
    worksheet.columns = [
      { width: 15 }, // A - Brand
      { width: 15 }, // B - Barcode  
      { width: 35 }, // C - Product name
      { width: 10 }, // D - Quantity
      { width: 15 }, // E - Unit price
      { width: 15 }, // F - Total
    ];

    // Header section with basic formatting
    const headerRow = worksheet.getRow(1);
    headerRow.getCell('A1').value = 'CUISIMAT';
    headerRow.getCell('A1').font = { bold: true, size: 16 };
    
    headerRow.getCell('F1').value = 'DEVIS';
    headerRow.getCell('F1').font = { bold: true, size: 14 };
    headerRow.getCell('F1').alignment = { horizontal: 'right' };

    // Customer info section (rows 2-5)
    worksheet.getCell('A2').value = 'Nom du Client:';
    worksheet.getCell('A2').font = { bold: true };
    worksheet.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } };
    
    worksheet.getCell('A3').value = 'Adresse / Tel:';
    worksheet.getCell('A3').font = { bold: true };
    worksheet.getCell('A3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } };
    
    worksheet.getCell('A4').value = 'Ville:';
    worksheet.getCell('A4').font = { bold: true };
    worksheet.getCell('A4').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } };
    
    worksheet.getCell('A5').value = 'Commercial:';
    worksheet.getCell('A5').font = { bold: true };
    worksheet.getCell('A5').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } };

    // Quote info section (right side)
    worksheet.getCell('E3').value = 'Date:';
    worksheet.getCell('E3').font = { bold: true };
    
    worksheet.getCell('E4').value = 'N° de pièce:';
    worksheet.getCell('E4').font = { bold: true };
    
    worksheet.getCell('E5').value = 'N° de cmd:';
    worksheet.getCell('E5').font = { bold: true };

    // Table headers (row 7)
    const headerRowTable = worksheet.getRow(7);
    const headers = ['Brand', 'BARCODE', 'TITLE', 'QTE', 'PU TTC', 'TOTAL TTC'];
    headers.forEach((header, index) => {
      const cell = headerRowTable.getCell(index + 1);
      cell.value = header;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } };
      cell.alignment = { horizontal: 'center' };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });

    // Add borders to data rows (8-47)
    for (let row = 8; row <= 47; row++) {
      for (let col = 1; col <= 6; col++) {
        const cell = worksheet.getCell(row, col);
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      }
    }

    // Totals section (rows 48-50)
    worksheet.getCell('E48').value = 'TOTAL HT:';
    worksheet.getCell('E48').font = { bold: true };
    worksheet.getCell('E48').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } };
    
    worksheet.getCell('E49').value = 'TVA 20%:';
    worksheet.getCell('E49').font = { bold: true };
    worksheet.getCell('E49').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } };
    
    worksheet.getCell('E50').value = 'TOTAL TTC:';
    worksheet.getCell('E50').font = { bold: true };
    worksheet.getCell('E50').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } };

    // Notes section
    worksheet.getCell('A52').value = 'Note:';
    worksheet.getCell('A52').font = { bold: true };

    return workbook;
  }

  // Populate worksheet with quote data using ExcelJS
  private static async populateWorksheetWithExcelJS(
    worksheet: ExcelJS.Worksheet, 
    quote: Quote, 
    items: QuoteItem[], 
    pageNumber: number, 
    totalPages: number
  ): Promise<void> {
    // Customer Information - Red section on the left (column C, rows 2-5)
    worksheet.getCell('C2').value = quote.customer.fullName; // name goes here
    worksheet.getCell('C3').value = `${quote.customer.address} / ${quote.customer.phoneNumber}`; // address and phone goes here separated by a pipe
    worksheet.getCell('C4').value = quote.customer.city; // city
    worksheet.getCell('C5').value = quote.customer.salesPerson; // sales person
    
    // Quote Information - Right side (column F, rows 3-5)
    worksheet.getCell('F3').value = this.formatDate(quote.createdAt); // date here
    worksheet.getCell('F4').value = quote.quoteNumber; // quote N° here
    worksheet.getCell('F5').value = quote.commandNumber || 'Not Confirmed yet'; // order N° here

    // Populate items starting from row 8 (after header row 7)
    items.forEach((item, index) => {
      const rowIndex = 8 + index;
      worksheet.getCell(`A${rowIndex}`).value = item.product.brand; // Brand
      worksheet.getCell(`B${rowIndex}`).value = item.product.barcode; // BARCODE
      worksheet.getCell(`C${rowIndex}`).value = item.product.name; // TITLE
      worksheet.getCell(`D${rowIndex}`).value = item.quantity; // QTE
      worksheet.getCell(`E${rowIndex}`).value = parseFloat(item.unitPrice.toFixed(2)); // PU TTC
      worksheet.getCell(`F${rowIndex}`).value = parseFloat(item.subtotal.toFixed(2)); // TOTAL TTC
    });

    // Calculate and populate totals (only on the last page)
    if (pageNumber === totalPages) {
      const totals = this.calculateTotals(quote.totalAmount);
      worksheet.getCell('F48').value = parseFloat(totals.ht.toFixed(2)); // TOTAL HT
      worksheet.getCell('F49').value = parseFloat(totals.tva.toFixed(2)); // TVA 20%
      worksheet.getCell('F50').value = parseFloat(totals.ttc.toFixed(2)); // TOTAL TTC
    }

    // Add notes if available
    if (quote.notes && pageNumber === totalPages) {
      worksheet.getCell('C51').value = quote.notes; // note here
    }
    
    // Note: Footer details on line 52 are preserved from the template and should not be overwritten
  }

  // Export items to simple Excel format (for cart copy functionality)
  static async exportItemsToExcel(items: QuoteItem[], filename?: string): Promise<void> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Articles');
    
    // Set column widths
    worksheet.columns = [
      { header: 'Marque', key: 'brand', width: 15 },
      { header: 'Code-barres', key: 'barcode', width: 15 },
      { header: 'Nom du produit', key: 'name', width: 30 },
      { header: 'Quantité', key: 'quantity', width: 10 },
      { header: 'Prix unitaire', key: 'unitPrice', width: 15 },
      { header: 'Sous-total', key: 'subtotal', width: 15 }
    ];

    // Add data
    items.forEach(item => {
      worksheet.addRow({
        brand: item.product.brand,
        barcode: item.product.barcode,
        name: item.product.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        subtotal: item.subtotal
      });
    });

    // Style the header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

    const exportFilename = filename || `Articles_${this.formatDate(new Date()).replace(/\//g, '-')}.xlsx`;
    
    // Export file
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { 
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
    });
    
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = exportFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }

  // Generate copy text for Excel paste (tab-separated)
  static generateCopyText(items: QuoteItem[]): string {
    const header = 'Marque\tCode-barres\tNom du produit\tQuantité\tPrix unitaire\tSous-total';
    const rows = items.map(item => 
      `${item.product.brand}\t${item.product.barcode}\t${item.product.name}\t${item.quantity}\t${item.unitPrice.toFixed(2)}\t${item.subtotal.toFixed(2)}`
    );
    
    return [header, ...rows].join('\n');
  }
}