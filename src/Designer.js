import React, { Component } from 'react';
import ReactDOM from 'react-dom';
import _ from 'lodash';
import {HotKeys} from 'react-hotkeys';
import Radium from 'radium';

// 没有被用到？
// import Icon from './Icon';

import InsertMenu from './panels/InsertMenu';
import SVGRenderer from './SVGRenderer';
import Handler from './Handler';
import {modes} from './constants';
import * as actions from './actions';
import {Text, Path, Rect, Circle} from './objects';
import PanelList from './panels/PanelList';

class Designer extends Component {

  static defaultProps = {

    // 还支持的属性有：
    // width
    // height
    // objects: 图元数据
    // onUpdate: func(objs)

    objectTypes: {
      'text': Text,
      'rectangle': Rect,
      'circle': Circle,
      'polygon': Path
    },
    snapToGrid: 1, // 指网格的粒度，缺省1表示不使用网格
    svgStyle: {},
    insertMenu: InsertMenu
  };

  state = {

    mode: modes.FREE,

    handler: {
      top: 200,
      left: 200,
      width: 50,
      height: 50,
      rotate: 0
    },

    currentObjectIndex: null,
    selectedObjectIndex: null,

    selectedTool: null // 当前选中的画刷

    // startPoint: 用来缓存当前正在操作的对象的尺寸坐标以及鼠标位置等各种信息
  };

  keyMap = {
    'removeObject': ['del', 'backspace'],
    'moveLeft': ['left', 'shift+left'],
    'moveRight': ['right', 'shift+right'],
    'moveUp': ['up', 'shift+up'],
    'moveDown': ['down', 'shift+down'],
    'closePath': ['enter']
  };

  componentWillMount() {
    this.objectRefs = {};
  }
  
  showHandler(index) {
    let {mode} = this.state;
    let {objects} = this.props;
    let object = objects[index];

    if (mode !== modes.FREE) {
      return;
    }

    this.updateHandler(index, object);
    this.setState({
      currentObjectIndex: index,
      showHandler: true
    });
  }

  hideHandler() {
    let {mode} = this.state;
    if (mode === modes.FREE) {
      this.setState({
        showHandler: false
      });
    }
  }

  // 获取startPoint
  getStartPointBundle(event, object) {
    // bundle这个单词看得好烦

    let {currentObjectIndex} = this.state;
    let {objects} = this.props;
    let mouse = this.getMouseCoords(event);
    object = object || objects[currentObjectIndex];
    return {
      clientX: mouse.x,
      clientY: mouse.y,
      objectX: object.x,
      objectY: object.y,
      width: object.width,
      height: object.height,
      rotate: object.rotate
    };
  }

  // handler onMouseDown 等事件的响应
  startDrag(mode, event) {
    // 被各种事件调用

    let {currentObjectIndex} = this.state;
    this.setState({
      mode: mode, // 确定模式，是drag, scale, 还是rotate
      startPoint: this.getStartPointBundle(event),
      selectedObjectIndex: currentObjectIndex // 当光标下的对象设为真正选中
    });
  }

  // 取消选中对象
  resetSelection() {
    this.setState({
      selectedObjectIndex: null
    });
  }

  // svg mouse down 事件响应
  newObject(event) {
    // 这个函数名取得很晦涩！谁能首先联想到newObject跟鼠标按下的关系？

    let {mode, selectedTool} = this.state;

    this.resetSelection(event);

    if (mode !== modes.DRAW) { // 4
      return;
    }

    // 以下仅对 draw 状态生效

    let {meta} = this.getObjectComponent(selectedTool);
    let mouse = this.getMouseCoords(event);
    
    let {objects, onUpdate} = this.props;
    let object = {
      ...meta.initial,
      type: selectedTool,
      x: mouse.x,
      y: mouse.y
    };
   
    onUpdate([...objects, object]);

    this.setState({
      currentObjectIndex: objects.length,
      selectedObjectIndex: objects.length,
      startPoint: this.getStartPointBundle(event, object),
      mode: meta.editor ? modes.EDIT_OBJECT : modes.SCALE,
      selectedTool: null
    });
    
  }

  updatePath(object) {
    let {path} = object;
    let diffX = object.x - object.moveX;
    let diffY = object.y - object.moveY;
    
    let newPath = path.map(({x1, y1, x2, y2, x, y}) => ({
      x1: diffX + x1,
      y1: diffY + y1,
      x2: diffX + x2,
      y2: diffY + y2,
      x: diffX + x,
      y: diffY + y
    }));

    return {
      ...object,
      path: newPath,
      moveX: object.x,
      moveY: object.y
    };
  }

  updateObject(objectIndex, changes, updatePath) {
    let {objects, onUpdate} = this.props;

    onUpdate(objects.map((object, index) => {
      if (index === objectIndex) {
        let newObject = {
          ...object,
          ...changes
        };
        return updatePath
                ? this.updatePath(newObject) 
                : newObject;
      } else {
        return object;
      }
    }));
  }

  // 取得画图区域的client位置
  getOffset() {
    let parent = this.svgElement.getBoundingClientRect(); // 取到svg元素的位置

    let {canvasWidth, canvasHeight} = this.getCanvas();
    return {
      x: parent.left,
      y: parent.top,
      width: canvasWidth,
      height: canvasHeight
    };
  }

  // 将对象里的client坐标修正为相对于画布的坐标
  applyOffset(bundle) {
    let offset = this.getOffset();
    return {
      ...bundle,
      x: bundle.x - offset.x,
      y: bundle.y - offset.y
    }
  }

  updateHandler(index, object) {
    let target = this.objectRefs[index];
    let bbox = target.getBoundingClientRect();
    let {canvasOffsetX, canvasOffsetY} = this.getCanvas();

    let handler = {
      ...this.state.handler,
      width: object.width || bbox.width,
      height: object.height || bbox.height,
      top: object.y + canvasOffsetY,
      left: object.x + canvasOffsetX,
      rotate: object.rotate
    };

    if (!object.width) {
      let offset = this.getOffset();
      handler = {
        ...handler,
        left: bbox.left - offset.x,
        top: bbox.top - offset.y
      };
    }
    
    this.setState({
      handler: handler
    });
  }

  // 将坐标修正为对齐到网格
  snapCoordinates({x, y}) {
    let {snapToGrid} = this.props;
    return {
      x: x - (x % snapToGrid),
      y: y - (y % snapToGrid)
    };
  }

  // 获取鼠标相对于画图区的位置（进行网格修正）
  getMouseCoords({clientX, clientY}) {
    let coords = this.applyOffset({
      x: clientX,
      y: clientY
    });

    return this.snapCoordinates(coords);
  }

  onDrag(event) {

    // 这个方法只要鼠标移动就会被调用，是否过于频繁？
    let {currentObjectIndex, startPoint, mode} = this.state;
    let {objects} = this.props;

    let object = objects[currentObjectIndex];

    let mouse = this.getMouseCoords(event);

    let {scale, rotate, drag} = actions;

    let map = {
      [modes.SCALE]: scale,
      [modes.ROTATE]: rotate,
      [modes.DRAG]: drag
    };

    // 取到当前模式对应的action
    let action = map[mode];

    // 如果有action
    if (action) { // 则执行该action

      let newObject = action({
        object, 
        startPoint, 
        mouse, 
        objectIndex: currentObjectIndex, 
        objectRefs: this.objectRefs
      });

      this.updateObject(currentObjectIndex, newObject);
      this.updateHandler(currentObjectIndex, newObject);
    }
    
    if (currentObjectIndex !== null) {
      this.detectOverlappedObjects(event);
    }
  }

  detectOverlappedObjects(event) {
    let {currentObjectIndex} = this.state;
    let {objects} = this.props;
    let mouse = this.getMouseCoords(event);

    let refs = this.objectRefs,
        keys = Object.keys(refs),
        offset = this.getOffset();

    let currentRect = (refs[currentObjectIndex]
                       .getBoundingClientRect());

    keys.filter(
      (object, index) => index !== currentObjectIndex
    ).forEach((key) => {
      let rect = refs[key].getBoundingClientRect();
      let {left, top, width, height} = rect;
      
      left -= offset.x;
      top -= offset.y;

      let isOverlapped = (
        mouse.x > left && mouse.x < left + width &&
        mouse.y > top && mouse.y < top + height &&
        currentRect.width > width && 
        currentRect.height > height
      );

      if (isOverlapped) {
        this.showHandler(Number(key));
      }
    });
  }
  
  stopDrag() {
    let {mode} = this.state;

    if (_.contains([modes.DRAG,
                    modes.ROTATE,
                    modes.SCALE], mode)) {
      this.setState({
        mode: modes.FREE
      });
    }
  }
  
  showEditor() {
    let {selectedObjectIndex} = this.state;
    
    let {objects} = this.props,
      currentObject = objects[selectedObjectIndex],
      objectComponent = this.getObjectComponent(currentObject.type);

    if (objectComponent.meta.editor) {
      this.setState({
        mode: modes.EDIT_OBJECT,
        showHandler: false
      });
    }
  }

  getObjectComponent(type) {
    let {objectTypes} = this.props;
    return objectTypes[type];
  }

  // 获取画图区域的一些坐标信息
  getCanvas() {
    let {width, height} = this.props;
    let {
      canvasWidth=width, 
      canvasHeight=height
    } = this.props;
    return {
      width, height, canvasWidth, canvasHeight,
      canvasOffsetX: (canvasWidth - width) / 2,
      canvasOffsetY: (canvasHeight - height) / 2
    };
  }

  renderSVG() {

    let canvas = this.getCanvas();
    let {width, height, canvasOffsetX, canvasOffsetY} = canvas;

    let {background, objects, svgStyle, objectTypes} = this.props;

    return (
      <SVGRenderer 
         background={background}
         width={width}
         canvas={canvas}
         height={height}
         objects={objects}
         onMouseOver={this.showHandler.bind(this)}
         objectTypes={objectTypes}
         objectRefs={this.objectRefs}
         onRender={(ref) => this.svgElement = ref}
         onMouseDown={this.newObject.bind(this)} />
    );
  }

  selectTool(tool) {
    this.setState({
      selectedTool: tool,
      mode: modes.DRAW,
      currentObjectIndex: null,
      showHandler: false,
      handler: null
    });
  }

  handleObjectChange(key, value) {
    let {selectedObjectIndex} = this.state;
    this.updateObject(selectedObjectIndex, {
      [key]: value
    });
  }

  handleArrange(arrange) {
    let {selectedObjectIndex} = this.state;
    let {objects} = this.props;
    let object = objects[selectedObjectIndex];

    let arrangers = {
      'front': (rest, object) => ([[...rest, object], rest.length]),
      'back': (rest, object) => ([[object, ...rest], 0])
    };

    let rest = objects.filter(
      (object, index) => 
        selectedObjectIndex !== index
    );

    this.setState({
      selectedObjectIndex: null
    }, () => {

      let arranger = arrangers[arrange];
      let [arranged, newIndex] = arranger(rest, object);
      this.props.onUpdate(arranged);
      this.setState({
        selectedObjectIndex: newIndex
      });
    });
  }

  removeCurrent() {
    let {selectedObjectIndex} = this.state;
    let {objects} = this.props;

    let rest = objects.filter(
      (object, index) => 
        selectedObjectIndex !== index
    );

    this.setState({
      currentObjectIndex: null,
      selectedObjectIndex: null,
      showHandler: false,
      handler: null
    }, () => {
      this.objectRefs = {};
      this.props.onUpdate(rest);
    });
  }

  moveSelectedObject(attr, points, event, key) {
    let {selectedObjectIndex} = this.state;
    let {objects} = this.props;
    let object = objects[selectedObjectIndex];
    
    if (key.startsWith('shift')) {
      points *= 10;
    }

    let changes = {
      ...object,
      [attr]: object[attr] + points
    };
    
    this.updateObject(selectedObjectIndex, changes);
    this.updateHandler(selectedObjectIndex, changes);
  }

  getKeymapHandlers() {
    let handlers = {
      removeObject: this.removeCurrent.bind(this),
      moveLeft: this.moveSelectedObject.bind(this, 'x', -1),
      moveRight: this.moveSelectedObject.bind(this, 'x', 1),
      moveUp: this.moveSelectedObject.bind(this, 'y', -1),
      moveDown: this.moveSelectedObject.bind(this, 'y', 1),
      closePath: () => this.setState({mode: modes.FREE})
    };

    return _.mapValues(handlers, (handler) => (event, key) => {
      if (event.target.tagName !== 'INPUT') {
        event.preventDefault();
        handler(event, key);
      }
    });
  }

  render() {

    // 取state
    let {showHandler, // 是否标记图案为可操作状态
      handler, // handle的区域
        mode, 
         selectedObjectIndex, selectedTool} = this.state;
    
    // 取props
    let {
      objects, 
      objectTypes, 
      insertMenu: InsertMenuComponent
    } = this.props;

    let selectedObj = objects[selectedObjectIndex],
      isEditMode = mode === modes.EDIT_OBJECT, // 是否处于编辑模式。貌似仅对多边形有效
        showPropertyPanel = selectedObjectIndex !== null;

    let {width, height, canvasWidth, canvasHeight} = this.getCanvas();
    
    // 当前图元组件类相关数据
    let objectComponent,  // 对象对应的组件类
      objectWithInitial, 
      ObjectEditor;

    if (selectedObj) { // 是否当前有选中图元
      objectComponent = this.getObjectComponent(selectedObj.type);
      objectWithInitial = {
        ...objectComponent.meta.initial,
        ...selectedObj
      };
      ObjectEditor = objectComponent.meta.editor;
    }
    
    return (
      <HotKeys
        keyMap={this.keyMap}
        style={styles.keyboardManager} 
        handlers={this.getKeymapHandlers()}>
        <div className={'container'}
             style={{
                ...styles.container,
                ...this.props.style,
                width: canvasWidth,
                height: canvasHeight
             }} 

             onMouseMove={this.onDrag.bind(this)}
             onMouseUp={this.stopDrag.bind(this)}>

          {/* 是否显示Editor */}
          {null && isEditMode && ObjectEditor && (
             <ObjectEditor object={selectedObj}
                 offset={this.getOffset()}
                 onUpdate={(object) => 
                    this.updateObject(selectedObjectIndex, object)}
                 onClose={() => this.setState({mode: modes.FREE})}
                 width={width}
                 height={height} />)}

          {/* 是否显示 handle */}
          {showHandler && (
            <Handler
              boundingBox={handler}
              canResize={_(selectedObj).has('width') ||
                         _(selectedObj).has('height')}
              canRotate={_(selectedObj).has('rotate')}
              onMouseLeave={this.hideHandler.bind(this)}
              onDoubleClick={this.showEditor.bind(this)}
              onDrag={this.startDrag.bind(this, modes.DRAG)} 
              onResize={this.startDrag.bind(this, modes.SCALE)}
              onRotate={this.startDrag.bind(this, modes.ROTATE)} /> )}
          
          {/* 显示左边面板 */}
          {InsertMenuComponent && (
            <InsertMenuComponent tools={objectTypes}
              currentTool={selectedTool}
              onSelect={this.selectTool.bind(this)} />
          )}

          {/* 主画布 */}
          {this.renderSVG()}

          {/* 属性窗口 */}
          {showPropertyPanel && (
            <PanelList
              offset={this.getOffset()}
              object={objectWithInitial}
              onArrange={this.handleArrange.bind(this)}
              onChange={this.handleObjectChange.bind(this)}
              objectComponent={objectComponent} />
          )}

        </div>
      </HotKeys>
    );
  }

}

export const styles = {
  container: {
    position: 'relative'
  },
  keyboardManager: {
    outline: 'none'
  }
}

export default Radium(Designer);
