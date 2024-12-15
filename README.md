# [Video To GIF Converter](https://dylansallred.github.io/Video-To-Gif-Converter)

A modern, browser-based tool for converting video clips to GIF animations with advanced customization options.

## Live Demo
Visit [Video To GIF Converter](https://dylansallred.github.io/Video-To-Gif-Converter/VideoToGif.html)

## Features

### Video Preview
- Upload and preview video files directly in the browser
- Interactive timeline with draggable markers for precise time selection
- Play/Pause functionality
- Audio mute toggle
- Loop playback within the selected range
- Frame-by-frame navigation using arrow keys
- Playhead scrubbing for precise frame selection

### Customization Options
- **Frame Rate Selection:** Choose between 5-30 fps
- **Output Size Control:** Adjust from 25% to 100% of the original size
- **Speed Control:** Adjust playback speed from 1x to 5x
- **Dithering Options:**
  - No Dithering (default)
  - Floyd-Steinberg
  - Light Dithering
  - Stucki
- Real-time GIF preview
- File size estimation
- Double-click GIF preview for fullscreen view

### User Interface
- Expandable panels for better workspace organization
- Detailed conversion progress with status updates
- Conversion time and file statistics display
- Keyboard shortcuts for efficient timeline control
- Cancel conversion option
- Mobile-optimized touch controls

### Keyboard Shortcuts
- **Space:** Play/Pause video
- **[:** Set start marker at current position
- **]:** Set end marker at current position
- **←/→:** Step frame by frame (hold for continuous stepping)

### Progress Tracking
- Real-time conversion progress bar
- Detailed frame processing information
- Estimated file size and dimensions display
- Conversion time tracking

### User Experience
- Responsive design for desktop and mobile
- Settings persistence between sessions
- Works entirely in the browser - no server processing needed
- Helpful tips panel with optimization suggestions
- Visual feedback for settings changes

## Usage

1. **Upload Video**
   - Click the file input area or drag and drop a video file
   - Video will appear in the preview panel

2. **Adjust Time Range**
   - Use timeline markers to select start and end points
   - Fine-tune using time input fields
   - Preview selection using play button

3. **Configure Settings**
   - Adjust frame rate for smoothness vs. file size
   - Select output size
   - Choose dithering method for color optimization

4. **Convert and Download**
   - Click "Convert to GIF" to process
   - Preview the result
   - Click "Download GIF" to save

## Technical Details

- Built with vanilla JavaScript
- Uses HTML5 Canvas for video processing
- Implements gif.js library for GIF encoding
- Client-side processing only
- Multi-threaded processing using Web Workers
- Adaptive worker count based on CPU cores

### Performance Optimizations
- Dynamic worker allocation
- Efficient frame capture
- Memory management during conversion
- Cancelable conversion process

### Browser Compatibility
- Chrome (recommended)
- Firefox
- Safari
- Edge

### Performance Notes
Processing time depends on:
- Video size
- Selected duration
- Frame rate
- Output dimensions

### Tips for Optimal File Size
- Use shorter durations
- Lower frame rates (10-15 fps) for most cases
- Reduce output size if original is large
- Experiment with dithering options
- Adjust playback speed for longer videos

## Development

1. Clone the repository
2. Open `VideoToGif.html` in a modern web browser
3. No build process or dependencies required

## License
MIT License - feel free to use and modify as needed.

## Credits
- Uses [gif.js](https://jnordberg.github.io/gif.js/) for GIF encoding
- Interface design inspired by modern web applications
- SVG Icons from [Feather Icons](https://feathericons.com/)
