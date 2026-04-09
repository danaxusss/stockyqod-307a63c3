import React, { useState } from 'react';
import { X, Upload, FileSpreadsheet, AlertCircle, CheckCircle, Loader, Trash2, Calculator, Settings } from 'lucide-react';
import * as ExcelJS from 'exceljs';
import { Product, ExcelRow } from '../types';
import { ProductUploadService } from '../utils/productUploadService';
import { ActivityLogger } from '../utils/activityLogger';
import { useToast } from '../context/ToastContext';

interface ExcelUploadModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export function ExcelUploadModal({ onClose, onSuccess }: ExcelUploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [parsedData, setParsedData] = useState<Product[] | null>(null);
  const [sellingMultiplier, setSellingMultiplier] = useState(1.56);
  const [resellerMultiplier, setResellerMultiplier] = useState(1.30);
  const { showToast } = useToast();

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setParsedData(null);
    }
  };

  const parseNumericValue = (value: any): number => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      // Remove any currency symbols, spaces, and convert to number
      const cleaned = value.replace(/[$€£¥Dh,\s]/g, '');
      const parsed = parseFloat(cleaned);
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  };

  const parseExcelFile = (file: File): Promise<Product[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = async (e) => {
        try {
          const buffer = e.target?.result as ArrayBuffer;
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(buffer);
          
          const worksheet = workbook.worksheets[0];
          if (!worksheet) {
            throw new Error('No worksheet found in the Excel file');
          }
          
          // Convert worksheet to array format
          const jsonData: any[][] = [];
          worksheet.eachRow((row, rowNumber) => {
            const rowData: any[] = [];
            row.eachCell((cell, colNumber) => {
              rowData[colNumber - 1] = cell.text || cell.value || '';
            });
            jsonData.push(rowData);
          });

          console.log('Données Excel brutes (5 premières lignes):', jsonData.slice(0, 5));

          // Find header row and create column mapping
          let headerRowIndex = -1;
          let columnMapping: { [key: string]: number } = {};

          for (let i = 0; i < Math.min(5, jsonData.length); i++) {
            const row = jsonData[i];
            const rowStr = row.join('').toLowerCase();
            
            if (rowStr.includes('barcode') || rowStr.includes('product') || rowStr.includes('stock')) {
              headerRowIndex = i;
              
              // Create column mapping with improved detection for all fields
              row.forEach((header: string, index: number) => {
                const headerLower = String(header).toLowerCase().trim();
                if (headerLower.includes('barcode')) columnMapping.barcode = index;
                else if (headerLower.includes('product') && headerLower.includes('name')) columnMapping.productName = index;
                else if (headerLower.includes('brand') || headerLower.includes('categorie') || headerLower.includes('catégorie') || headerLower === 'marque') columnMapping.brand = index;
                else if (headerLower.includes('stock') && headerLower.includes('location')) columnMapping.stockLocation = index;
                else if (headerLower.includes('stock') && headerLower.includes('level')) columnMapping.stockLevel = index;
                else if (
                  headerLower.includes('buy') && headerLower.includes('price') ||
                  headerLower === 'buy price' ||
                  headerLower === 'buy_price' ||
                  headerLower === 'buyprice' ||
                  headerLower === 'prix achat' ||
                  headerLower === 'prix d\'achat' ||
                  headerLower === 'prix_achat'
                ) columnMapping.buyPrice = index;
                else if (
                  headerLower === 'reseller' ||
                  headerLower === 'reseller price' ||
                  headerLower === 'reseller_price' ||
                  headerLower.includes('prix revendeur')
                ) columnMapping.resellerPrice = index;
                else if (
                  headerLower === 'regular price' ||
                  headerLower === 'regular_price' ||
                  headerLower === 'sell price' ||
                  headerLower === 'sell_price' ||
                  headerLower === 'prix vente' ||
                  headerLower === 'price' ||
                  (headerLower.includes('regular') && headerLower.includes('price'))
                ) columnMapping.regularPrice = index;
                else if (headerLower.includes('provider') || headerLower.includes('supplier') || headerLower === 'fournisseur') columnMapping.provider = index;
              });
              break;
            }
          }

          if (headerRowIndex === -1) {
            throw new Error('Impossible de trouver la ligne d\'en-tête. Veuillez vous assurer que votre fichier Excel contient des en-têtes comme "barcode", "product name", etc.');
          }

          console.log('En-tête trouvé à la ligne:', headerRowIndex);
          console.log('Mappage des colonnes:', columnMapping);

          // Validate required columns
          const requiredColumns = ['barcode', 'productName', 'stockLocation', 'stockLevel', 'buyPrice'];
          const missingColumns = requiredColumns.filter(col => columnMapping[col] === undefined);
          
          if (missingColumns.length > 0) {
            throw new Error(`Colonnes requises manquantes: ${missingColumns.join(', ')}`);
          }

          // Process data rows
          const dataRows = jsonData.slice(headerRowIndex + 1);
          const productMap = new Map<string, Product>();

          dataRows.forEach((row, index) => {
            if (!row || row.length === 0 || row.every(cell => !cell)) return; // Skip empty rows
            
            const barcode = String(row[columnMapping.barcode] || '').trim();
            const productName = String(row[columnMapping.productName] || '').trim();
            const brand = columnMapping.brand !== undefined ? String(row[columnMapping.brand] || '').trim() : '';
            const stockLocation = String(row[columnMapping.stockLocation] || '').toLowerCase().trim();
            const stockLevel = parseNumericValue(row[columnMapping.stockLevel]);
            const buyPrice = parseNumericValue(row[columnMapping.buyPrice]);
            const provider = columnMapping.provider !== undefined ? String(row[columnMapping.provider] || '').trim() : '';

            // Use actual prices from Excel if available, otherwise calculate from buy price
            const rawResellerPrice = columnMapping.resellerPrice !== undefined ? parseNumericValue(row[columnMapping.resellerPrice]) : 0;
            const rawRegularPrice = columnMapping.regularPrice !== undefined ? parseNumericValue(row[columnMapping.regularPrice]) : 0;
            const sellPrice = rawRegularPrice > 0 ? rawRegularPrice : buyPrice * sellingMultiplier;
            const resellerPrice = rawResellerPrice > 0 ? rawResellerPrice : buyPrice * resellerMultiplier;

            console.log(`Ligne ${index + headerRowIndex + 2}:`, {
              barcode,
              productName,
              brand,
              stockLocation,
              stockLevel,
              buyPrice,
              sellPrice: `${buyPrice} × ${sellingMultiplier} = ${sellPrice.toFixed(2)}`,
              resellerPrice: `${buyPrice} × ${resellerMultiplier} = ${resellerPrice.toFixed(2)}`,
              provider,
              rawStockLevel: row[columnMapping.stockLevel],
              rawBuyPrice: row[columnMapping.buyPrice],
              rawProvider: row[columnMapping.provider]
            });

            if (!barcode || !productName) {
              console.log(`Ignorer la ligne ${index + headerRowIndex + 2} - code-barres ou nom manquant`);
              return;
            }

            let product = productMap.get(barcode);
            
            if (!product) {
              product = {
                barcode,
                name: productName,
                brand,
                techsheet: '',
                price: sellPrice,
                buyprice: buyPrice,
                reseller_price: resellerPrice,
                provider,
                stock_levels: {}
              };
              productMap.set(barcode, product);
            }

            // Update prices (take the highest value if multiple rows)
            if (sellPrice > 0) product.price = Math.max(product.price, sellPrice);
            if (buyPrice > 0) product.buyprice = Math.max(product.buyprice, buyPrice);
            if (resellerPrice > 0) product.reseller_price = Math.max(product.reseller_price, resellerPrice);
            
            // Update brand and provider if not already set
            if (brand && !product.brand) product.brand = brand;
            if (provider && !product.provider) product.provider = provider;

            // Aggregate stock by location
            const normalizedLocation = stockLocation.replace(/\s+/g, '_') || 'default';
            if (product.stock_levels[normalizedLocation]) {
              product.stock_levels[normalizedLocation] += stockLevel;
            } else {
              product.stock_levels[normalizedLocation] = stockLevel;
            }
          });

          const products = Array.from(productMap.values());
          console.log('Produits analysés finaux:', products.slice(0, 3));
          
          if (products.length === 0) {
            throw new Error('Aucun produit valide trouvé dans le fichier Excel');
          }

          resolve(products);
        } catch (error) {
          console.error('Erreur d\'analyse Excel:', error);
          reject(new Error(`Échec de l\'analyse du fichier Excel: ${error instanceof Error ? error.message : 'Erreur inconnue'}`));
        }
      };

      reader.onerror = () => {
        reject(new Error('Échec de la lecture du fichier'));
      };

      reader.readAsArrayBuffer(file);
    });
  };

  const handlePreview = async () => {
    if (!file) return;

    setIsUploading(true);

    try {
      const products = await parseExcelFile(file);
      console.log('Produits analysés pour aperçu:', products);
      setParsedData(products);
      showToast({
        type: 'success',
        title: 'Analyse réussie',
        message: `${products.length} produits analysés avec succès depuis le fichier Excel`
      });
    } catch (err) {
      console.error('Erreur d\'aperçu:', err);
      showToast({
        type: 'error',
        title: 'Erreur d\'analyse',
        message: err instanceof Error ? err.message : 'Échec de l\'analyse du fichier Excel'
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleReset = async () => {
    const confirmed = window.confirm(
      'Êtes-vous sûr de vouloir supprimer TOUS les produits de la base de données ? Cette action est irréversible.'
    );
    
    if (!confirmed) return;

    setIsResetting(true);

    try {
      await ProductUploadService.deleteAllProducts();
      showToast({
        type: 'success',
        title: 'Suppression réussie',
        message: 'Tous les produits ont été supprimés de la base de données avec succès'
      });
      
      await ActivityLogger.log('products_deleted', 'All products deleted');
      
      // Reset parsed data since we've cleared everything
      setParsedData(null);
      setFile(null);
      
      // Notify parent component to refresh
      setTimeout(() => {
        onSuccess();
      }, 1500);
    } catch (err) {
      console.error('Erreur de réinitialisation:', err);
      showToast({
        type: 'error',
        title: 'Erreur de suppression',
        message: err instanceof Error ? err.message : 'Échec de la suppression des produits'
      });
    } finally {
      setIsResetting(false);
    }
  };

  const handleUpload = async () => {
    if (!parsedData) return;

    setIsUploading(true);

    try {
      console.log('Téléchargement des produits:', parsedData);
      
      // Upload to Supabase
      await ProductUploadService.uploadProducts(parsedData);
      
      await ActivityLogger.log('products_imported', `${parsedData.length} products imported`);

      showToast({
        type: 'success',
        title: 'Upload réussi',
        message: `${parsedData.length} produits téléchargés avec succès dans la base de données`
      });
      
      // Notify parent component
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 2000);
    } catch (err) {
      console.error('Erreur de téléchargement:', err);
      showToast({
        type: 'error',
        title: 'Erreur d\'upload',
        message: err instanceof Error ? err.message : 'Échec du téléchargement des produits'
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
              <FileSpreadsheet className="h-5 w-5 text-blue-600 dark:text-blue-300" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Télécharger Fichier Excel
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6">
          <div className="mb-6">
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Téléchargez un fichier Excel avec les colonnes suivantes (les prix de vente et revendeur seront calculés automatiquement) :
            </p>
            <div className="bg-gray-50 dark:bg-slate-700 rounded-lg p-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="font-medium">• barcode</span>
                <span className="font-medium">• product name</span>
                <span className="font-medium">• brand</span>
                <span className="font-medium">• stock location</span>
                <span className="font-medium">• stock level</span>
                <span className="font-medium text-blue-600 dark:text-blue-400">• buy price (requis)</span>
                <span className="font-medium">• provider</span>
              </div>
              <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                <p className="text-sm text-blue-700 dark:text-blue-300 font-medium">
                  ✨ Nouveau : Les prix de vente et revendeur sont calculés automatiquement !
                </p>
                <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                  Configurez les multiplicateurs ci-dessous pour générer les prix automatiquement.
                </p>
              </div>
            </div>
          </div>

          {/* Price Multipliers Configuration */}
          <div className="mb-6 p-4 bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 border border-purple-200 dark:border-purple-800 rounded-lg">
            <div className="flex items-center space-x-2 mb-4">
              <Calculator className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              <h3 className="text-lg font-semibold text-purple-900 dark:text-purple-100">
                Configuration des Multiplicateurs de Prix
              </h3>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Multiplicateur Prix de Vente
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={sellingMultiplier}
                    onChange={(e) => setSellingMultiplier(parseFloat(e.target.value) || 1.56)}
                    step="0.01"
                    min="1.00"
                    max="10.00"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                  />
                  <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-sm text-gray-500 dark:text-gray-400">
                    ×
                  </span>
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  Prix de vente = Prix d'achat × {sellingMultiplier}
                </p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Multiplicateur Prix Revendeur
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={resellerMultiplier}
                    onChange={(e) => setResellerMultiplier(parseFloat(e.target.value) || 1.30)}
                    step="0.01"
                    min="1.00"
                    max="10.00"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                  />
                  <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-sm text-gray-500 dark:text-gray-400">
                    ×
                  </span>
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  Prix revendeur = Prix d'achat × {resellerMultiplier}
                </p>
              </div>
            </div>
            
            {/* Example Calculation */}
            <div className="mt-4 p-3 bg-white dark:bg-slate-700 rounded-lg border border-gray-200 dark:border-gray-600">
              <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-2">Exemple de Calcul :</h4>
              <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                <div>Prix d'achat : <span className="font-mono">100.00 Dh</span></div>
                <div>Prix de vente : <span className="font-mono text-green-600 dark:text-green-400">{(100 * sellingMultiplier).toFixed(2)} Dh</span> (100 × {sellingMultiplier})</div>
                <div>Prix revendeur : <span className="font-mono text-blue-600 dark:text-blue-400">{(100 * resellerMultiplier).toFixed(2)} Dh</span> (100 × {resellerMultiplier})</div>
              </div>
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Sélectionner Fichier Excel
            </label>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileSelect}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
            />
          </div>

          {parsedData && (
            <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <h3 className="font-medium text-blue-900 dark:text-blue-100 mb-2">
                Aperçu ({parsedData.length} produits)
              </h3>
              <div className="mb-2 text-xs text-blue-800 dark:text-blue-200">
                Prix calculés avec multiplicateurs : Vente ×{sellingMultiplier} | Revendeur ×{resellerMultiplier}
              </div>
              <div className="max-h-40 overflow-y-auto">
                {parsedData.slice(0, 5).map((product, index) => (
                  <div key={index} className="text-sm text-blue-800 dark:text-blue-200 py-1">
                    <strong>{product.barcode}</strong> - {product.name}
                    {product.brand && <> | Marque: {product.brand}</>}
                    {product.provider && <> | Fournisseur: {product.provider}</>}
                    {' | '}Achat: {product.buyprice.toFixed(2)} Dh
                    {' | '}Vente: {product.price.toFixed(2)} Dh
                    {' | '}Revendeur: {product.reseller_price.toFixed(2)} Dh
                    {' | '}Stock: {Object.entries(product.stock_levels).map(([location, level]) => `${location}: ${level}`).join(', ')}
                  </div>
                ))}
                {parsedData.length > 5 && (
                  <div className="text-sm text-blue-600 dark:text-blue-400 py-1">
                    ... et {parsedData.length - 5} produits de plus
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Annuler
            </button>
            
            {/* Reset Products Button */}
            <button
              onClick={handleReset}
              disabled={isResetting || isUploading}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white rounded-lg transition-colors disabled:cursor-not-allowed flex items-center space-x-2"
            >
              {isResetting ? (
                <>
                  <Loader className="h-4 w-4 animate-spin" />
                  <span>Suppression...</span>
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  <span>Réinitialiser</span>
                </>
              )}
            </button>
            
            {!parsedData ? (
              <button
                onClick={handlePreview}
                disabled={!file || isUploading || isResetting}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white rounded-lg transition-colors disabled:cursor-not-allowed flex items-center justify-center space-x-2"
              >
                {isUploading ? (
                  <>
                    <Loader className="h-4 w-4 animate-spin" />
                    <span>Analyse...</span>
                  </>
                ) : (
                  <>
                    <Calculator className="h-4 w-4" />
                    <span>Aperçu</span>
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={handleUpload}
                disabled={isUploading || isResetting}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white rounded-lg transition-colors disabled:cursor-not-allowed flex items-center justify-center space-x-2"
              >
                {isUploading ? (
                  <>
                    <Loader className="h-4 w-4 animate-spin" />
                    <span>Téléchargement...</span>
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    <span>Confirmer</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}