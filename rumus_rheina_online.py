
# rumus_rheina_online.py
# Created by Udin-Mol
# Versi online untuk Railway
from flask import Flask

app = Flask(__name__)

@app.route('/')
def home():
    return "Rumus Rheina API - Online - Created by Udin-Mol"

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
