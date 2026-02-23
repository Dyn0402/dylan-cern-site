#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Created on February 23 9:58 AM 2026
Created in PyCharm
Created as dylan-cern-site/wsgi.py

@author: Dylan Neff, dylan
"""

from app import app as application

if __name__ == "__main__":
    application.run()