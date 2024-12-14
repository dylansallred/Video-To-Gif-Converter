# Video To GIF Converter

A modern, browser-based tool for converting video clips to GIF animations with advanced customization options.

## Features

### Video Preview
- Upload and preview video files directly in the browser
- Interactive timeline with draggable markers for precise time selection
- Play/Pause functionality
- Audio mute toggle
- Loop playback within the selected range

### Customization Options
- **Frame Rate Selection:** Choose between 5-30 fps
- **Output Size Control:** Adjust from 25% to 100% of the original size
- **Dithering Options:**
  - No Dithering
  - Floyd-Steinberg (default)
  - Light Dithering
  - Stucki
- Real-time GIF preview
- File size estimation

### User Experience
- Responsive design for desktop and mobile
- Settings persistence between sessions
- Works entirely in the browser - no server processing needed

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

## Development

1. Clone the repository
2. Open `giftovideo.html` in a modern web browser
3. No build process or dependencies required

## Live Demo
Visit [GIF TO VIDEO](https://dylansallred.github.io/Video-To-Gif/giftovideo.html)

## License
MIT License - feel free to use and modify as needed.

## Credits
- Uses [gif.js](https://jnordberg.github.io/gif.js/) for GIF encoding
- Interface design inspired by modern web applications
- Icons from [Feather Icons](https://feathericons.com/)
