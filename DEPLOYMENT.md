# ACTC Web Project Deployment Guide

This guide will help you deploy the ACTC Web project to your SSH server at `parallels@10.211.55.15`.

## Prerequisites

- macOS or Linux system
- SSH access to the target server
- Server credentials (username: `parallels`, password: `2doiouxi`)

## Quick Deployment

### Option 1: HTTP Only (Recommended for testing)

```bash
# Make the script executable
chmod +x deploy-http.sh

# Run the deployment script
./deploy-http.sh
```

### Option 2: Full Deployment with SSL (Requires domain name)

```bash
# Make the script executable
chmod +x deploy.sh

# Run the deployment script
./deploy.sh
```

## What the Deployment Scripts Do

The deployment scripts will automatically:

1. **Install Dependencies** on the remote server:
   - Node.js 18.x
   - MongoDB 6.0
   - nginx web server
   - PM2 process manager

2. **Setup Project Structure**:
   - Create necessary directories
   - Sync project files
   - Install npm dependencies
   - Create environment configuration

3. **Configure Services**:
   - nginx configuration for web serving
   - PM2 ecosystem for process management
   - MongoDB database setup

4. **Start the Application**:
   - Launch the Node.js application
   - Configure auto-start on boot
   - Create management scripts

## Manual Deployment Steps

If you prefer to deploy manually, follow these steps:

### 1. Connect to the Server

```bash
ssh parallels@10.211.55.15
```

### 2. Install System Dependencies

```bash
# Update package list
sudo apt-get update

# Install Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install MongoDB
wget -qO - https://www.mongodb.org/static/pgp/server-6.0.asc | sudo apt-key add -
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/6.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-6.0.list
sudo apt-get update
sudo apt-get install -y mongodb-org

# Install nginx
sudo apt-get install -y nginx

# Install PM2
sudo npm install -g pm2
```

### 3. Setup MongoDB

```bash
# Start and enable MongoDB
sudo systemctl enable mongod
sudo systemctl start mongod

# Verify MongoDB is running
sudo systemctl status mongod
```

### 4. Create Project Directory

```bash
mkdir -p ~/actc_web
cd ~/actc_web
```

### 5. Upload Project Files

From your local machine:

```bash
# Using rsync (recommended)
rsync -avz --progress \
    --exclude 'node_modules/' \
    --exclude '.git/' \
    --exclude 'venv/' \
    ./ parallels@10.211.55.15:~/actc_web/

# Or using scp
scp -r ./* parallels@10.211.55.15:~/actc_web/
```

### 6. Install Dependencies

```bash
cd ~/actc_web
npm install --production
```

### 7. Create Environment File

```bash
cat > .env << EOF
MONGO_URI=mongodb://localhost:27017/actc_website
JWT_SECRET=actc_super_secret_jwt_key_2025_production_secure
PORT=5001
NODE_ENV=production
EOF
```

### 8. Start the Application

```bash
# Start with PM2
pm2 start server.js --name "actc-web"

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

### 9. Configure nginx

```bash
# Create nginx configuration
sudo tee /etc/nginx/sites-available/actc-web << 'EOF'
server {
    listen 80;
    server_name _;
    
    root /home/parallels/actc_web/public;
    index index.html;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    location /api/ {
        proxy_pass http://localhost:5001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    
    location /uploads/ {
        alias /home/parallels/actc_web/uploads/;
    }
}
EOF

# Enable the site
sudo ln -sf /etc/nginx/sites-available/actc-web /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Test and reload nginx
sudo nginx -t
sudo systemctl reload nginx
```

## Post-Deployment

### Access the Application

- **Main Site**: http://10.211.55.15
- **Admin Panel**: http://10.211.55.15/admin
- **API Endpoint**: http://10.211.55.15/api

### Default Admin Credentials

- **Username**: `admin`
- **Password**: `admin`

⚠️ **Important**: Change the default password after first login!

### Management Commands

```bash
# Connect to server
ssh parallels@10.211.55.15

# Navigate to project directory
cd ~/actc_web

# View application status
pm2 status

# View logs
pm2 logs actc-web

# Restart application
pm2 restart actc-web

# Stop application
pm2 stop actc-web

# Start application
pm2 start actc-web
```

## Troubleshooting

### Common Issues

1. **Port Already in Use**
   ```bash
   # Check what's using port 5001
   sudo netstat -tlnp | grep :5001
   
   # Kill the process if needed
   sudo kill -9 <PID>
   ```

2. **MongoDB Connection Issues**
   ```bash
   # Check MongoDB status
   sudo systemctl status mongod
   
   # Start MongoDB if stopped
   sudo systemctl start mongod
   ```

3. **Permission Issues**
   ```bash
   # Fix file permissions
   sudo chown -R parallels:parallels ~/actc_web
   chmod +x ~/actc_web/*.sh
   ```

4. **nginx Configuration Errors**
   ```bash
   # Test nginx configuration
   sudo nginx -t
   
   # Check nginx error logs
   sudo tail -f /var/log/nginx/error.log
   ```

### Log Files

- **Application Logs**: `~/actc_web/logs/`
- **PM2 Logs**: `pm2 logs actc-web`
- **nginx Logs**: `/var/log/nginx/`
- **MongoDB Logs**: `/var/log/mongodb/`

## Security Considerations

1. **Change Default Passwords**: Update admin password immediately
2. **Firewall**: Configure server firewall to allow only necessary ports
3. **SSL**: For production, set up SSL certificates with Let's Encrypt
4. **Updates**: Keep system packages and Node.js updated
5. **Backups**: Regular backups of database and uploads

## Performance Optimization

1. **PM2 Clustering**: Application runs in cluster mode for better performance
2. **nginx Caching**: Static files are cached for 30 days
3. **Gzip Compression**: Enabled for text-based files
4. **Memory Management**: PM2 restarts app if memory exceeds 1GB

## Support

If you encounter issues during deployment:

1. Check the logs for error messages
2. Verify all services are running
3. Ensure firewall settings allow necessary ports
4. Check file permissions and ownership

For additional help, refer to the project documentation or contact the development team.

## Cron Jobs

### 自動提交逾時考試（expired-attempts）

系統在 `server.js` 中透過 `setInterval` 每 **5 分鐘**自動呼叫一次內部端點，將逾時但仍處於 `in_progress` 狀態的考試作答紀錄自動評分並關閉。**單一伺服器實例部署時不需外部 cron**。

#### 端點

```
POST /api/cron/expired-attempts
```

#### 驗證機制

所有 cron 端點皆需同時通過以下兩道驗證，缺一不可：

1. **`X-Cron-Secret` 標頭**：值必須與環境變數 `CRON_SECRET` 完全相符。
2. **IP 允許清單**：請求來源 IP 必須在 `CRON_ALLOWED_IPS` 所列的範圍內（預設僅允許 `127.0.0.1`）。

#### 相關環境變數

| 變數名稱 | 必填 | 說明 | 範例值 |
|---|---|---|---|
| `CRON_SECRET` | 是（cron 啟用時） | 驗證 cron 請求的共用密鑰 | `my-secret-32chars` |
| `CRON_ALLOWED_IPS` | 否 | 逗號分隔的允許 IP 清單，預設 `127.0.0.1` | `127.0.0.1,10.0.0.5` |

#### 多實例部署（外部 cron）

在多個 Node.js 實例（例如 PM2 cluster mode 或 Kubernetes 多副本）的環境下，每個實例各自的 `setInterval` 都會觸發，造成重複處理。建議改用外部 cron 只對單一實例呼叫：

1. 關閉所有實例的內部定時器（在 `server.js` 中以環境變數 `DISABLE_INTERNAL_CRON=true` 做條件判斷）。
2. 在系統 crontab 或排程服務中，每 5 分鐘呼叫一次：

```bash
# crontab 範例（每 5 分鐘執行）
*/5 * * * * curl -s -X POST https://your-site.example.com/api/cron/expired-attempts \
  -H "X-Cron-Secret: ${CRON_SECRET}" \
  -H "Content-Type: application/json"
```

#### 回應格式

```json
{
  "message": "Expired attempts processed",
  "total": 3,
  "processed": 3,
  "errors": 0
}
```

- `total`：找到的逾時作答筆數。
- `processed`：成功處理（含自動評分）的筆數。
- `errors`：處理失敗的筆數（詳細錯誤見伺服器日誌）。

#### 已知限制

- 若考試文件已從資料庫刪除（`exam` 參照為 null），該作答紀錄會被標記為 `expired` 但**不執行評分**，並在日誌中記錄警告。這是預期行為，不影響其他筆資料的處理。
