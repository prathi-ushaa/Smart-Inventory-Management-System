# Cloud-Based Smart Inventory Management System

React + Node/Express + MongoDB, containerised with Docker, tested in a VirtualBox VM,
deployed on AWS EC2 with SNS low-stock email alerts, plus a CloudSim peak-hour simulation.

```
inventory-cloud/
├── docker-compose.yml
├── backend/      Express API (auth, products, stock movements, insights, CSV report)
│   └── src/alerts.js    low-stock alert: console log, plus Amazon SNS email when SNS_TOPIC_ARN is set
├── frontend/     React (Vite) UI served by Nginx
└── cloudsim/     InventorySimulation.java
```

## What makes it "smart"
- **Low-stock alerts:** when a stock-out takes a product down through its reorder level, an alert fires (once, not on every sale).
- **Reorder suggestions:** from the last 30 days of stock going out, the API estimates usage per day, days of stock left,
  and how many units to order to cover the next 30 days. Items at or below their reorder level, or with 7 days or less left, are listed.
- **No overselling:** a stock-out is one atomic database update that only succeeds if enough stock remains.

## Roles
| Role | Can do |
|---|---|
| Staff | Record stock in/out, view products, dashboard, history, download CSV |
| Admin | Everything staff can do, plus add and delete products |

## 1. Run locally with Docker
```bash
docker compose up --build
```
Open http://localhost. Create an **admin** account, add a few products with a reorder level, then record
stock-outs. Watch the dashboard: the product moves into "Reorder suggestions" once it reaches its reorder level.
`docker compose logs -f backend` shows the `LOW STOCK:` alert line.

Handy: `docker compose down`, `docker compose down -v` (wipes the database).

## 2. Run inside Oracle VirtualBox (private cloud)
1. Create an Ubuntu Server 22.04 VM (2 CPU, 4 GB RAM, 20 GB disk).
2. Network: NAT with port forwarding Host 8080 -> Guest 80 (and Host 2222 -> Guest 22 for SSH).
3. Inside the VM:
```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
sudo usermod -aG docker $USER && newgrp docker
cd inventory-cloud && docker compose up -d --build
```
4. Open http://localhost:8080 on your host. Screenshot the VM, `docker ps` and the app.

## 3. Deploy on AWS with SNS email alerts
1. **EC2** -> Launch Ubuntu 22.04 t2.micro/t3.micro, create a key pair.
   Security Group: SSH (22) from *My IP*, HTTP (80) from anywhere.
2. **SNS** -> Create topic (Standard) named `low-stock-alerts`. Create a subscription: protocol Email, your address,
   then click the confirmation link in the email AWS sends. Copy the topic ARN.
3. **IAM** -> Create a policy that allows publishing to that topic only:
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "sns:Publish",
    "Resource": "arn:aws:sns:REGION:ACCOUNT-ID:low-stock-alerts"
  }]
}
```
   Create an EC2 **role** with this policy and attach it to the instance (Actions -> Security -> Modify IAM role).
   No access keys are stored anywhere.
4. Because the API runs inside a container, raise the metadata hop limit so it can reach the role credentials:
   EC2 -> Actions -> Instance settings -> *Modify instance metadata options* -> hop limit = **2**.
5. SSH in, install Docker as above, copy the project, then:
```bash
cp .env.example .env      # set JWT_SECRET, SNS_TOPIC_ARN, AWS_REGION
docker compose up -d --build
```
6. Open `http://<EC2-public-IP>`, record a stock-out that crosses a reorder level, and check your inbox.
7. Extras for the report: CloudWatch CPU graph and alarm, S3 bucket for CSV reports, ALB + Auto Scaling (health check `/api/health`).
   Stop or terminate the instance when done to avoid charges.

## 4. CloudSim peak-hour simulation
1. Download CloudSim 3.0.3 and note the path of `cloudsim-3.0.3.jar`.
2. From the `cloudsim/` folder:
```bash
javac -cp cloudsim-3.0.3.jar InventorySimulation.java
java  -cp .:cloudsim-3.0.3.jar InventorySimulation      # Windows: use ; instead of :
```
It simulates 200/1000/2000 requests (85% light stock updates, 15% heavy insight/report jobs) on
2/5/10 VMs, time-shared vs space-shared, and prints average response time, makespan and cost.
Chart it in Excel and use it to justify your EC2 size / Auto Scaling settings.

## Production notes (mention in viva)
- Open registration is demo-only; restrict admin account creation.
- Set a strong `JWT_SECRET`; add HTTPS (ALB + ACM); move MongoDB to a managed service.
- Reorder suggestions use a simple moving average. Seasonality or ML forecasting (your AI & DS strength) is a natural next step.
- For barcode scanners or IoT shelves, send movements through the same `/move` endpoint, or via SQS + Lambda at scale.
