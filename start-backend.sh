#!/bin/bash
cd backend
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
