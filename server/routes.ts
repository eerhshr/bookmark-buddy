import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import multer from "multer";
import { z } from "zod";
import * as cheerio from "cheerio";
import { insertBookmarkSchema, insertCategorySchema } from "@shared/schema";

// Set up multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/html' || file.originalname.endsWith('.html')) {
      cb(null, true);
    } else {
      cb(new Error('Only HTML files are allowed'));
    }
  }
});

// Category classification mapping
const categoryKeywords = {
  'Development': ['github', 'stackoverflow', 'codepen', 'dev.to', 'programming', 'code', 'developer', 'api', 'documentation', 'tutorial'],
  'News & Media': ['news', 'bbc', 'cnn', 'reuters', 'medium', 'blog', 'article', 'press'],
  'Recipes': ['recipe', 'cooking', 'food', 'kitchen', 'chef', 'culinary', 'restaurant', 'dinner'],
  'Certification': ['certification', 'course', 'training', 'udemy', 'coursera', 'aws', 'certified', 'exam'],
  'Shopping': ['amazon', 'shop', 'store', 'buy', 'purchase', 'retail', 'ecommerce'],
  'Social Media': ['facebook', 'twitter', 'instagram', 'linkedin', 'social', 'reddit'],
  'Entertainment': ['youtube', 'netflix', 'entertainment', 'movie', 'video', 'music', 'game'],
  'Reference': ['wikipedia', 'reference', 'documentation', 'manual', 'guide'],
};

const categoryColors = {
  'Development': '#1976D2',
  'News & Media': '#FF5722',
  'Recipes': '#FFC107',
  'Certification': '#4CAF50',
  'Shopping': '#9C27B0',
  'Social Media': '#2196F3',
  'Entertainment': '#F44336',
  'Reference': '#607D8B',
  'Other': '#9E9E9E'
};

function classifyBookmark(title: string, url: string, folder?: string): string {
  const text = `${title} ${url} ${folder || ''}`.toLowerCase();
  
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some(keyword => text.includes(keyword))) {
      return category;
    }
  }
  
  return 'Other';
}

function generateBookmarkHTML(bookmarks: any[]): string {
  const categorizedBookmarks = new Map<string, any[]>();
  
  bookmarks.forEach(bookmark => {
    const category = bookmark.category || 'Other';
    if (!categorizedBookmarks.has(category)) {
      categorizedBookmarks.set(category, []);
    }
    categorizedBookmarks.get(category)!.push(bookmark);
  });

  let html = `<!DOCTYPE html>
<html>
<head>
    <title>Organized Bookmarks</title>
    <meta charset="UTF-8">
</head>
<body>
    <h1>Organized Bookmarks</h1>
`;

  for (const [category, bookmarkList] of categorizedBookmarks.entries()) {
    html += `    <h2>${category}</h2>\n    <dl>\n`;
    bookmarkList.forEach(bookmark => {
      html += `        <dt><a href="${bookmark.url}">${bookmark.title}</a></dt>\n`;
    });
    html += `    </dl>\n`;
  }

  html += `</body>
</html>`;
  return html;
}

function generateReportHTML(analysisData: any): string {
  return `<!DOCTYPE html>
<html>
<head>
    <title>Bookmark Analysis Report</title>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }
        .stat-card { background: #f5f5f5; padding: 20px; border-radius: 8px; }
        .category-list { list-style: none; padding: 0; }
        .category-item { display: flex; justify-content: space-between; padding: 10px; background: #fff; margin: 5px 0; border-radius: 4px; }
    </style>
</head>
<body>
    <h1>Bookmark Analysis Report</h1>
    <div class="stats">
        <div class="stat-card">
            <h3>Total Bookmarks</h3>
            <p style="font-size: 2em; margin: 0;">${analysisData.stats.totalBookmarks}</p>
        </div>
        <div class="stat-card">
            <h3>Categories</h3>
            <p style="font-size: 2em; margin: 0;">${analysisData.stats.categories}</p>
        </div>
        <div class="stat-card">
            <h3>Unique Domains</h3>
            <p style="font-size: 2em; margin: 0;">${analysisData.stats.domains}</p>
        </div>
        <div class="stat-card">
            <h3>Duplicates</h3>
            <p style="font-size: 2em; margin: 0;">${analysisData.stats.duplicates}</p>
        </div>
    </div>
    <h2>Category Breakdown</h2>
    <ul class="category-list">
        ${analysisData.categories.map((cat: any) => `
            <li class="category-item">
                <span>${cat.name}</span>
                <span>${cat.count} bookmarks</span>
            </li>
        `).join('')}
    </ul>
</body>
</html>`;
}

function extractDomain(url: string): string {
  try {
    const domain = new URL(url).hostname;
    return domain.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

function parseBookmarkHtml(html: string) {
  const $ = cheerio.load(html);
  const bookmarks: any[] = [];
  
  function processBookmarkNode(element: any, folder = '') {
    $(element).find('a').each((_, linkElement) => {
      const $link = $(linkElement);
      const title = $link.text().trim();
      const url = $link.attr('href');
      
      if (title && url && url.startsWith('http')) {
        const domain = extractDomain(url);
        const category = classifyBookmark(title, url, folder);
        
        bookmarks.push({
          title,
          url,
          domain,
          category,
          folder: folder || 'Bookmarks',
          favicon: `https://www.google.com/s2/favicons?domain=${domain}`
        });
      }
    });
    
    // Process nested folders
    $(element).find('dt').each((_, dt) => {
      const $dt = $(dt);
      const folderName = $dt.find('h3').first().text().trim();
      if (folderName) {
        const $dl = $dt.next('dl');
        if ($dl.length) {
          processBookmarkNode($dl, folderName);
        }
      }
    });
  }
  
  // Start processing from the root
  processBookmarkNode($('body'));
  
  return bookmarks;
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Upload and analyze bookmarks
  app.post('/api/bookmarks/upload', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
      }

      const html = req.file.buffer.toString('utf-8');
      const parsedBookmarks = parseBookmarkHtml(html);
      
      if (parsedBookmarks.length === 0) {
        return res.status(400).json({ message: 'No bookmarks found in the uploaded file' });
      }

      // Clear existing data
      await storage.clearBookmarks();
      await storage.clearCategories();

      // Validate and create bookmarks
      const validatedBookmarks = parsedBookmarks.map(bookmark => 
        insertBookmarkSchema.parse(bookmark)
      );

      const createdBookmarks = await storage.createBookmarksBulk(validatedBookmarks);

      // Create categories with counts
      const categoryStats = new Map<string, number>();
      createdBookmarks.forEach(bookmark => {
        const count = categoryStats.get(bookmark.category || 'Other') || 0;
        categoryStats.set(bookmark.category || 'Other', count + 1);
      });

      for (const [name, count] of Array.from(categoryStats.entries())) {
        await storage.createCategory({
          name,
          count,
          color: categoryColors[name as keyof typeof categoryColors] || categoryColors.Other
        });
      }

      // Create analysis result
      const uniqueDomains = new Set(createdBookmarks.map(b => b.domain)).size;
      const duplicateUrls = createdBookmarks.map(b => b.url);
      const duplicates = duplicateUrls.length - new Set(duplicateUrls).size;

      await storage.createAnalysisResult({
        totalBookmarks: createdBookmarks.length,
        totalCategories: categoryStats.size,
        totalDomains: uniqueDomains,
        duplicates
      });

      res.json({ 
        success: true, 
        message: `Successfully processed ${createdBookmarks.length} bookmarks`,
        bookmarksCount: createdBookmarks.length
      });
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Failed to process bookmark file' 
      });
    }
  });

  // Get analysis data
  app.get('/api/analysis', async (req, res) => {
    try {
      const analysisData = await storage.getAnalysisData();
      res.json(analysisData);
    } catch (error) {
      console.error('Analysis error:', error);
      res.status(500).json({ message: 'Failed to get analysis data' });
    }
  });

  // Get bookmarks with optional filtering
  app.get('/api/bookmarks', async (req, res) => {
    try {
      const { category, search, page = '1', limit = '10' } = req.query;
      let bookmarks = await storage.getBookmarks();

      // Apply filters
      if (category && category !== 'all') {
        bookmarks = bookmarks.filter(b => b.category === category);
      }

      if (search) {
        const searchTerm = search.toString().toLowerCase();
        bookmarks = bookmarks.filter(b => 
          b.title.toLowerCase().includes(searchTerm) ||
          b.url.toLowerCase().includes(searchTerm) ||
          b.domain.toLowerCase().includes(searchTerm)
        );
      }

      // Apply pagination
      const pageNum = parseInt(page.toString());
      const limitNum = parseInt(limit.toString());
      const startIndex = (pageNum - 1) * limitNum;
      const endIndex = startIndex + limitNum;
      const paginatedBookmarks = bookmarks.slice(startIndex, endIndex);

      res.json({
        bookmarks: paginatedBookmarks,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: bookmarks.length,
          totalPages: Math.ceil(bookmarks.length / limitNum)
        }
      });
    } catch (error) {
      console.error('Bookmarks error:', error);
      res.status(500).json({ message: 'Failed to get bookmarks' });
    }
  });

  // Get categories
  app.get('/api/categories', async (req, res) => {
    try {
      const categories = await storage.getCategories();
      res.json(categories);
    } catch (error) {
      console.error('Categories error:', error);
      res.status(500).json({ message: 'Failed to get categories' });
    }
  });

  // Delete bookmark
  app.delete('/api/bookmarks/:id', async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteBookmark(parseInt(id));
      res.json({ success: true, message: 'Bookmark deleted successfully' });
    } catch (error) {
      console.error('Delete bookmark error:', error);
      res.status(500).json({ message: 'Failed to delete bookmark' });
    }
  });

  // Update bookmark
  app.patch('/api/bookmarks/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      const updatedBookmark = await storage.updateBookmark(parseInt(id), updates);
      res.json(updatedBookmark);
    } catch (error) {
      console.error('Update bookmark error:', error);
      res.status(500).json({ message: 'Failed to update bookmark' });
    }
  });

  // Export bookmarks
  app.get('/api/export/bookmarks', async (req, res) => {
    try {
      const bookmarks = await storage.getBookmarks();
      const htmlContent = generateBookmarkHTML(bookmarks);
      
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Disposition', 'attachment; filename="organized_bookmarks.html"');
      res.send(htmlContent);
    } catch (error) {
      console.error('Export error:', error);
      res.status(500).json({ message: 'Failed to export bookmarks' });
    }
  });

  // Export report
  app.get('/api/export/report', async (req, res) => {
    try {
      const analysisData = await storage.getAnalysisData();
      const reportContent = generateReportHTML(analysisData);
      
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Disposition', 'attachment; filename="bookmark_analysis_report.html"');
      res.send(reportContent);
    } catch (error) {
      console.error('Export report error:', error);
      res.status(500).json({ message: 'Failed to export report' });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
