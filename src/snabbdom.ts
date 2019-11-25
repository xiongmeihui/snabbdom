/* global module, document, Node */
import { Module } from "./modules/module";
import { Hooks } from "./hooks";
import vnode, { VNode, VNodeData, Key } from "./vnode";
import * as is from "./is";
import htmlDomApi, { DOMAPI } from "./htmldomapi";

function isUndef(s: any): boolean {
  return s === undefined;
}
function isDef(s: any): boolean {
  return s !== undefined;
}

type VNodeQueue = Array<VNode>;

const emptyNode = vnode("", {}, [], undefined, undefined);

function sameVnode(vnode1: VNode, vnode2: VNode): boolean {
  return vnode1.key === vnode2.key && vnode1.sel === vnode2.sel;
}

function isVnode(vnode: any): vnode is VNode {
  return vnode.sel !== undefined;
}

type KeyToIndexMap = { [key: string]: number };

type ArraysOf<T> = {
  [K in keyof T]: T[K][];
};

type ModuleHooks = ArraysOf<Module>;

function createKeyToOldIdx(
  children: Array<VNode>,
  beginIdx: number,
  endIdx: number
): KeyToIndexMap {
  let i: number,
    map: KeyToIndexMap = {},
    key: Key | undefined,
    ch;
  for (i = beginIdx; i <= endIdx; ++i) {
    ch = children[i];
    if (ch != null) {
      key = ch.key;
      if (key !== undefined) map[key] = i;
    }
  }
  return map;
}

const hooks: (keyof Module)[] = [
  "create",
  "update",
  "remove",
  "destroy",
  "pre",
  "post"
];

export { h } from "./h";
export { thunk } from "./thunk";

export function init(modules: Array<Partial<Module>>, domApi?: DOMAPI) {
  let i: number,
    j: number,
    cbs = {} as ModuleHooks; // 初始化 patch 函数需要执行的拓展 patch 的插件

  const api: DOMAPI = domApi !== undefined ? domApi : htmlDomApi;

  // 在不同生命周期扩展执行钩子函数，扩展patch函数的能力
  for (i = 0; i < hooks.length; ++i) {
    cbs[hooks[i]] = [];
    for (j = 0; j < modules.length; ++j) {
      const hook = modules[j][hooks[i]];
      if (hook !== undefined) {
        (cbs[hooks[i]] as Array<any>).push(hook);
      }
    }
  }

  function emptyNodeAt(elm: Element) {
    const id = elm.id ? "#" + elm.id : "";
    const c = elm.className ? "." + elm.className.split(" ").join(".") : "";
    return vnode(
      api.tagName(elm).toLowerCase() + id + c,
      {},
      [],
      undefined,
      elm
    );
  }

  function createRmCb(childElm: Node, listeners: number) {
    return function rmCb() {
      if (--listeners === 0) {
        const parent = api.parentNode(childElm);
        api.removeChild(parent, childElm);
      }
    };
  }

  function createElm(vnode: VNode, insertedVnodeQueue: VNodeQueue): Node {
    let i: any,
      data = vnode.data;
    // 执行 init 钩子 vnode 已经存在，但是还没创建 DOM 元素
    if (data !== undefined) {
      if (isDef((i = data.hook)) && isDef((i = i.init))) {
        i(vnode);
        data = vnode.data;
      }
    }
    let children = vnode.children,
      sel = vnode.sel;
    if (sel === "!") {
      if (isUndef(vnode.text)) {
        vnode.text = "";
      }
      // 创建注释节点
      vnode.elm = api.createComment(vnode.text as string);
    } else if (sel !== undefined) {
      // Parse selector
      const hashIdx = sel.indexOf("#");
      const dotIdx = sel.indexOf(".", hashIdx);
      const hash = hashIdx > 0 ? hashIdx : sel.length;
      const dot = dotIdx > 0 ? dotIdx : sel.length;
      const tag =
        hashIdx !== -1 || dotIdx !== -1
          ? sel.slice(0, Math.min(hash, dot))
          : sel;
      // 根真实 DOM
      const elm = (vnode.elm =
        isDef(data) && isDef((i = (data as VNodeData).ns))
          ? api.createElementNS(i, tag)
          : api.createElement(tag));
      if (hash < dot) elm.setAttribute("id", sel.slice(hash + 1, dot));
      if (dotIdx > 0)
        elm.setAttribute("class", sel.slice(dot + 1).replace(/\./g, " "));
      // 此时已经创建了根 DOM 元素，但还未创建子 DOM, 执行模块 create 钩子
      for (i = 0; i < cbs.create.length; ++i) cbs.create[i](emptyNode, vnode);
      if (is.array(children)) {
        for (i = 0; i < children.length; ++i) {
          const ch = children[i];
          if (ch != null) {
            // 递归创建真实子 dom
            api.appendChild(elm, createElm(ch as VNode, insertedVnodeQueue));
          }
        }
      } else if (is.primitive(vnode.text)) {
        api.appendChild(elm, api.createTextNode(vnode.text));
      }
      i = (vnode.data as VNodeData).hook; // Reuse variable
      // 整棵树创建完毕
      if (isDef(i)) {
        if (i.create) i.create(emptyNode, vnode);
        if (i.insert) insertedVnodeQueue.push(vnode);
      }
    } else {
      // 选择器不存在，表示为单纯的文本
      vnode.elm = api.createTextNode(vnode.text as string);
    }
    return vnode.elm;
  }

  function addVnodes(
    parentElm: Node,
    before: Node | null,
    vnodes: Array<VNode>,
    startIdx: number,
    endIdx: number,
    insertedVnodeQueue: VNodeQueue
  ) {
    for (; startIdx <= endIdx; ++startIdx) {
      const ch = vnodes[startIdx];
      if (ch != null) {
        api.insertBefore(parentElm, createElm(ch, insertedVnodeQueue), before);
      }
    }
  }

  function invokeDestroyHook(vnode: VNode) {
    let i: any,
      j: number,
      data = vnode.data;
    if (data !== undefined) {
      // destory 钩子
      if (isDef((i = data.hook)) && isDef((i = i.destroy))) i(vnode);
      for (i = 0; i < cbs.destroy.length; ++i) cbs.destroy[i](vnode);
      if (vnode.children !== undefined) {
        for (j = 0; j < vnode.children.length; ++j) {
          i = vnode.children[j];
          if (i != null && typeof i !== "string") {
            invokeDestroyHook(i);
          }
        }
      }
    }
  }

  function removeVnodes(
    parentElm: Node,
    vnodes: Array<VNode>,
    startIdx: number,
    endIdx: number
  ): void {
    for (; startIdx <= endIdx; ++startIdx) {
      let i: any,
        listeners: number,
        rm: () => void,
        ch = vnodes[startIdx];
      if (ch != null) {
        if (isDef(ch.sel)) {
          invokeDestroyHook(ch);
          listeners = cbs.remove.length + 1;
          rm = createRmCb(ch.elm as Node, listeners);
          for (i = 0; i < cbs.remove.length; ++i) cbs.remove[i](ch, rm);
          if (
            isDef((i = ch.data)) &&
            isDef((i = i.hook)) &&
            isDef((i = i.remove))
          ) {
            i(ch, rm);
          } else {
            rm();
          }
        } else {
          // Text node
          api.removeChild(parentElm, ch.elm as Node);
        }
      }
    }
  }

  function updateChildren(
    parentElm: Node,
    oldCh: Array<VNode>,
    newCh: Array<VNode>,
    insertedVnodeQueue: VNodeQueue
  ) {
    let oldStartIdx = 0,
      newStartIdx = 0;
    let oldEndIdx = oldCh.length - 1;
    let oldStartVnode = oldCh[0];
    let oldEndVnode = oldCh[oldEndIdx];
    let newEndIdx = newCh.length - 1;
    let newStartVnode = newCh[0];
    let newEndVnode = newCh[newEndIdx];
    let oldKeyToIdx: any;
    let idxInOld: number;
    let elmToMove: VNode;
    let before: any;

    // 遍历 oldCh newCh，对节点进行比较和更新
    // 每轮比较最多处理一个节点，算法复杂度 O(n)
    while (oldStartIdx <= oldEndIdx && newStartIdx <= newEndIdx) {
      // 首先找到新 vnode 的 children 和旧 vnode 的 children 都存在的部分
      // DFS
      if (oldStartVnode == null) {
        oldStartVnode = oldCh[++oldStartIdx]; // Vnode might have been moved left
      } else if (oldEndVnode == null) {
        oldEndVnode = oldCh[--oldEndIdx];
      } else if (newStartVnode == null) {
        newStartVnode = newCh[++newStartIdx];
      } else if (newEndVnode == null) {
        newEndVnode = newCh[--newEndIdx];
      } else if (sameVnode(oldStartVnode, newStartVnode)) {
        // 新旧开始节点相同，直接调用 patchVnode 进行更新，下标向中间推进
        patchVnode(oldStartVnode, newStartVnode, insertedVnodeQueue);
        oldStartVnode = oldCh[++oldStartIdx];
        newStartVnode = newCh[++newStartIdx];
      } else if (sameVnode(oldEndVnode, newEndVnode)) {
        patchVnode(oldEndVnode, newEndVnode, insertedVnodeQueue);
        oldEndVnode = oldCh[--oldEndIdx];
        newEndVnode = newCh[--newEndIdx];
      } else if (sameVnode(oldStartVnode, newEndVnode)) {
        // Vnode moved right
        // 旧开始节点等于新的结束节点，将该节点对应的 dom 移动到最后，调用 patchVnode 进行更新
        // 旧开始节点等于新的结束节点，说明节点向右移动了
        // 具体移动到哪，因为新节点处于末尾，所以添加到旧结束节点（会随着 updateChildren 左移）的后面
        // 注意这里需要移动 dom，因为节点右移了，而为什么是插入 oldEndVnode 的后面呢？
        // 可以分为两个情况来理解：
        // 1. 当循环刚开始，下标都还没有移动，那移动到 oldEndVnode 的后面就相当于是最后面，是合理的
        // 2. 循环已经执行过一部分了，因为每次比较结束后，下标都会向中间靠拢，而且每次都会处理一个节点,
        // 这时下标左右两边已经处理完成，可以把下标开始到结束区域当成是并未开始循环的一个整体，
        // 所以插入到 oldEndVnode 后面是合理的（在当前循环来说，也相当于是最后面，同 1）
        patchVnode(oldStartVnode, newEndVnode, insertedVnodeQueue);
        api.insertBefore(
          parentElm,
          oldStartVnode.elm as Node,
          api.nextSibling(oldEndVnode.elm as Node)
        );
        oldStartVnode = oldCh[++oldStartIdx];
        newEndVnode = newCh[--newEndIdx];
      } else if (sameVnode(oldEndVnode, newStartVnode)) {
        // Vnode moved left
        patchVnode(oldEndVnode, newStartVnode, insertedVnodeQueue);
        api.insertBefore(
          parentElm,
          oldEndVnode.elm as Node,
          oldStartVnode.elm as Node
        );
        oldEndVnode = oldCh[--oldEndIdx];
        newStartVnode = newCh[++newStartIdx];
      } else {
        // 如果以上 4 种情况都不匹配，可能存在下面 2 种情况
        // 1. 这个节点是新创建的
        // 2. 这个节点在原来的位置是处于中间的（oldStartIdx 和 oldEndIdx之间）
        if (oldKeyToIdx === undefined) {
          oldKeyToIdx = createKeyToOldIdx(oldCh, oldStartIdx, oldEndIdx);
        }
        // 检查新的 vnode 是否存在于老的 vnode 中
        idxInOld = oldKeyToIdx[newStartVnode.key as string];
        // 如果下标不存在，说明这个节点是新创建的
        if (isUndef(idxInOld)) {
          // New element
          api.insertBefore(
            parentElm,
            createElm(newStartVnode, insertedVnodeQueue),
            oldStartVnode.elm as Node
          );
          newStartVnode = newCh[++newStartIdx];
        } else {
          // 如果是已经存在的节点 找到需要移动位置的节点
          elmToMove = oldCh[idxInOld];
          if (elmToMove.sel !== newStartVnode.sel) {
            // 虽然 key 相同了，但是 seletor 不相同，需要调用 createElm 来创建新的 dom 节点
            api.insertBefore(
              parentElm,
              createElm(newStartVnode, insertedVnodeQueue),
              oldStartVnode.elm as Node
            );
          } else {
            patchVnode(elmToMove, newStartVnode, insertedVnodeQueue);
            // 在 oldCh 中将当前已经处理的 vnode 置空，等下次循环到这个下标的时候直接跳过
            oldCh[idxInOld] = undefined as any;
            api.insertBefore(
              parentElm,
              elmToMove.elm as Node,
              oldStartVnode.elm as Node
            );
          }
          newStartVnode = newCh[++newStartIdx];
        }
      }
    }
    // 循环结束后，可能会存在两种情况
    // 1. oldCh 已经全部处理完成，而 newCh 还有新的节点，需要对剩下的每个项都创建新的 dom
    if (oldStartIdx <= oldEndIdx || newStartIdx <= newEndIdx) {
      if (oldStartIdx > oldEndIdx) {
        before = newCh[newEndIdx + 1] == null ? null : newCh[newEndIdx + 1].elm;
        addVnodes(
          parentElm,
          before,
          newCh,
          newStartIdx,
          newEndIdx,
          insertedVnodeQueue
        );
      } else {
        // 2. newCh 已经全部处理完成，而 oldCh 还有旧的节点，需要将多余的节点移除
        removeVnodes(parentElm, oldCh, oldStartIdx, oldEndIdx);
      }
    }
  }

  function patchVnode(
    oldVnode: VNode,
    vnode: VNode,
    insertedVnodeQueue: VNodeQueue
  ) {
    let i: any, hook: any;
    // patch vnode 前 钩子
    if (
      isDef((i = vnode.data)) &&
      isDef((hook = i.hook)) &&
      isDef((i = hook.prepatch))
    ) {
      i(oldVnode, vnode);
    }
    const elm = (vnode.elm = oldVnode.elm as Node);
    let oldCh = oldVnode.children;
    let ch = vnode.children;
    if (oldVnode === vnode) return;
    if (vnode.data !== undefined) {
      for (i = 0; i < cbs.update.length; ++i) cbs.update[i](oldVnode, vnode);
      i = vnode.data.hook;
      if (isDef(i) && isDef((i = i.update))) i(oldVnode, vnode);
    }
    // patch vnode 的时候 text 的优先级更高
    if (isUndef(vnode.text)) {
      if (isDef(oldCh) && isDef(ch)) {
        // 新的 vnode 子节点更新
        if (oldCh !== ch)
          updateChildren(
            elm,
            oldCh as Array<VNode>,
            ch as Array<VNode>,
            insertedVnodeQueue
          );
      } else if (isDef(ch)) {
        if (isDef(oldVnode.text)) api.setTextContent(elm, "");
        addVnodes(
          elm,
          null,
          ch as Array<VNode>,
          0,
          (ch as Array<VNode>).length - 1,
          insertedVnodeQueue
        );
      } else if (isDef(oldCh)) {
        removeVnodes(
          elm,
          oldCh as Array<VNode>,
          0,
          (oldCh as Array<VNode>).length - 1
        );
      } else if (isDef(oldVnode.text)) {
        api.setTextContent(elm, "");
      }
    } else if (oldVnode.text !== vnode.text) {
      // 新的 vnode 是个文本，删除旧的 DOM 元素
      if (isDef(oldCh)) {
        removeVnodes(
          elm,
          oldCh as Array<VNode>,
          0,
          (oldCh as Array<VNode>).length - 1
        );
      }
      api.setTextContent(elm, vnode.text as string);
    }
    if (isDef(hook) && isDef((i = hook.postpatch))) {
      i(oldVnode, vnode);
    }
  }

  // 调用 patch 函数返回的始终是新的 vnode, 只是在这个过程中会执行对 dom 的更新
  return function patch(oldVnode: VNode | Element, vnode: VNode): VNode {
    let i: number, elm: Node, parent: Node;
    const insertedVnodeQueue: VNodeQueue = [];
    // 执行 pre 钩子
    for (i = 0; i < cbs.pre.length; ++i) cbs.pre[i]();

    // 如果传入的是个 DOM 元素，将它转成一个没有子节点的 vnode
    if (!isVnode(oldVnode)) {
      oldVnode = emptyNodeAt(oldVnode);
    }

    // 如果是同一棵虚拟 dom 树的变化，patch 该 dom 树的变化
    if (sameVnode(oldVnode, vnode)) {
      patchVnode(oldVnode, vnode, insertedVnodeQueue);
    } else {
      // 如果不是同一棵虚拟 dom 树，直接根据新的 vnode 渲染新的 dom 树
      elm = oldVnode.elm as Node;
      parent = api.parentNode(elm);

      // 根据 vnode 创建真实 dom
      createElm(vnode, insertedVnodeQueue);

      if (parent !== null) {
        // 将创建好的真实 DOM 插入 DOM 树
        api.insertBefore(parent, vnode.elm as Node, api.nextSibling(elm));
        // 删除旧的虚拟 DOM 对应的 DOM 元素
        removeVnodes(parent, [oldVnode], 0, 0);
      }
    }

    for (i = 0; i < insertedVnodeQueue.length; ++i) {
      (((insertedVnodeQueue[i].data as VNodeData).hook as Hooks).insert as any)(
        insertedVnodeQueue[i]
      );
    }
    for (i = 0; i < cbs.post.length; ++i) cbs.post[i]();
    return vnode;
  };
}
