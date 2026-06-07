


# Keep these as they are fast
from flask import Flask, request, jsonify, render_template, session
import os
import uuid
import datetime
import numpy as np
import librosa
import joblib
import tensorflow as tf 

app = Flask(__name__)
app.secret_key = "nlp_sentiment_analysis_secret_key_9c15"


UPLOAD_FOLDER = os.path.join(app.root_path, 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER


scaler = joblib.load('scaler.pkl')
encoder = joblib.load('encoder.pkl')
classes = encoder.categories_[0].tolist()

model = None 

def get_model():
    global model
    if model is None:
        print("Loading model into memory...")
        model = tf.keras.models.load_model('cnn_model.h5')
    return model


# Feature extraction helper functions matching Refined_Project_(2).ipynb
def zcr(data, frame_length=2048, hop_length=512):
    zcr_val = librosa.feature.zero_crossing_rate(data, frame_length=frame_length, hop_length=hop_length)
    return np.squeeze(zcr_val)

def rmse(data, frame_length=2048, hop_length=512):
    rmse_val = librosa.feature.rms(y=data, frame_length=frame_length, hop_length=hop_length)
    return np.squeeze(rmse_val)

def calculate_mfcc(data, sr, frame_length=2048, hop_length=512, flatten=True):
    # Call librosa.feature.mfcc with explicit y argument as done in the notebook
    mfcc_features = librosa.feature.mfcc(y=data, sr=sr)
    return np.squeeze(mfcc_features.T) if not flatten else np.ravel(mfcc_features.T)

def extract_features(data, sr=22050, frame_length=2048, hop_length=512):
    result = np.array([])
    result = np.hstack((
        zcr(data, frame_length, hop_length),
        rmse(data, frame_length, hop_length),
        calculate_mfcc(data, sr, frame_length, hop_length)
    ))
    return result





@app.route('/')
def index():
    return render_template('index.html')

@app.route('/analyze', methods=['POST'])
def analyze():
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file part in request'}), 400
    
    file = request.files['audio']
    if file.filename == '':
        return jsonify({'error': 'No selected audio file'}), 400
    
    # Save the file temporarily
    temp_filename = f"{uuid.uuid4().hex}_{file.filename}"
    temp_path = os.path.join(app.config['UPLOAD_FOLDER'], temp_filename)
    file.save(temp_path)
    
    try:
        # Load audio. The notebook uses duration=2.5 and offset=0.6.
        # We must handle files that are too short to have 0.6 offset or 2.5 duration.
        sr = 22050
        duration = 2.5
        offset = 0.6
        
        # Determine total duration of audio file
        total_duration = librosa.get_duration(path=temp_path)
        
        if total_duration < offset:
            # If extremely short, load from 0
            data, loaded_sr = librosa.load(temp_path, sr=sr, duration=duration, offset=0.0)
        else:
            # Load with the offset
            data, loaded_sr = librosa.load(temp_path, sr=sr, duration=duration, offset=offset)
        
        # Ensure exactly 55125 samples (2.5 seconds * 22050 Hz)
        target_length = int(duration * sr)
        if len(data) < target_length:
            data = np.pad(data, (0, target_length - len(data)), 'constant')
        elif len(data) > target_length:
            data = data[:target_length]
            
        # Extract features
        features = extract_features(data, sr=sr)
        
        # Scale features
        scaled_features = scaler.transform(features.reshape(1, -1))
        
        # Reshape to (1, 2376, 1) for the CNN
        model_input = scaled_features.reshape(1, 2376, 1)

        model = get_model()
        
        # Model predict
        predictions = model.predict(model_input)
        probs = predictions[0].tolist()
        
        # Find prediction emotion and confidence
        pred_idx = np.argmax(predictions[0])
        pred_emotion = classes[pred_idx]
        confidence = probs[pred_idx]
        
        # Map probabilities
        confidence_map = {classes[i]: probs[i] for i in range(len(classes))}
        
        # Add to history session
        if 'history' not in session:
            session['history'] = []
            
        history_item = {
            'filename': file.filename,
            'timestamp': datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            'emotion': pred_emotion,
            'confidence': confidence,
            'probabilities': confidence_map
        }
        
        session['history'].insert(0, history_item) # insert at start to show newest first
        session.modified = True
        
        return jsonify({
            'success': True,
            'emotion': pred_emotion,
            'confidence': confidence,
            'probabilities': confidence_map,
            'history_item': history_item
        })
        
    except Exception as e:
        print(f"Error during inference: {str(e)}")
        return jsonify({'error': f"Failed to analyze audio: {str(e)}"}), 500
        
    finally:
        # Clean up temporary file
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception as e:
                print(f"Error deleting temp file {temp_path}: {e}")

@app.route('/history', methods=['GET'])
def get_history():
    history = session.get('history', [])
    return jsonify({'history': history})

@app.route('/history/clear', methods=['POST'])
def clear_history():
    session['history'] = []
    session.modified = True
    return jsonify({'success': True})

if __name__ == '__main__':
    app.run(debug=True)