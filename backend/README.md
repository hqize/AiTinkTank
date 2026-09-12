## 1. processor层的import_processor的实现

​	import_processor层各个节点业务：

```mermaid
flowchart LR
    A[START]
    B[1.任务分发]
    C[2.PDF结构化解析]
    D[3.多模态图片理解]
    E[4.智能文档切片]
    F[5.主体识别与标签提取]
    G[6.混合向量化]
    H[7.数据持久化]
    I[END]
    
    A-->B
    B-->|PDF|C
    B-->|Markdown|D
    C-->D
    D-->E
    E-->F
    F-->G
    G-->H
    H-->I
    
    %% 核心样式设置：圆角 + 配色区分
    style A fill:#e8f4f8,stroke:#4299e1,stroke-width:2px,rx:20,ry:20
    style B fill:#ffff00,stroke:#4299e1,stroke-width:2px,rx:20,ry:20
    style I fill:#f0f8fb,stroke:#38b2ac,stroke-width:2px,rx:20,ry:20
```

![image-20260906221000285](README.assets/image-20260906221000285.png)

### 1.1 node_entry.py入口节点实现与单元测试

### 1.2 node_pdf_to_md.py 节点实现

- MinerU:能够将**非结构化或弱结构化文档**（如PDF、Word、PPT、Excel、图片、网页URL等）解析为**机器可读的Markdown、JSON、LaTeX、HTML等格式**
- 

