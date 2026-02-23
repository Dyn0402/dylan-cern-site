#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Created on February 23 9:57 AM 2026
Created in PyCharm
Created as dylan-cern-site/app.py

@author: Dylan Neff, dylan
"""

from flask import Flask

app = Flask(__name__)

@app.route('/')
def hello():
    return "<h1>Hello from CERN PaaS!</h1><p>Flask is running on OKD.</p>"

if __name__ == '__main__':
    # OKD uses port 8080 by default for non-root containers
    app.run(host='0.0.0.0', port=8080)
