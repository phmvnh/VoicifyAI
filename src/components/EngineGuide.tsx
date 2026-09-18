import { Cpu, Gauge, HardDrive, Sparkles } from "lucide-react";

export function EngineGuide() {
  return (
    <section className="engine-guide">
      <h3>Model &amp; hiệu năng</h3>
      <p className="settings-description">
        Chọn cấu hình phù hợp với máy và mức độ chính xác bạn cần.
      </p>

      <div className="engine-guide-grid">
        <article>
          <span className="guide-icon"><Sparkles size={16} /></span>
          <div>
            <h4>Model</h4>
            <p><strong>tiny / base:</strong> nhanh, nhẹ. <strong>small / medium:</strong> cân bằng. <strong>large-v3 / turbo:</strong> chính xác hơn nhưng cần máy mạnh.</p>
          </div>
        </article>
        <article>
          <span className="guide-icon"><Cpu size={16} /></span>
          <div>
            <h4>Thiết bị</h4>
            <p><strong>CPU</strong> dùng được trên hầu hết máy. <strong>CUDA</strong> nhanh hơn nếu có GPU NVIDIA tương thích.</p>
          </div>
        </article>
        <article>
          <span className="guide-icon"><HardDrive size={16} /></span>
          <div>
            <h4>Định dạng</h4>
            <p><strong>int8</strong> nhẹ, phù hợp CPU. <strong>float16</strong> phù hợp GPU. Chọn <strong>default</strong> để hệ thống tự quyết định.</p>
          </div>
        </article>
        <article>
          <span className="guide-icon"><Gauge size={16} /></span>
          <div>
            <h4>Chỉ số</h4>
            <p><strong>RTF dưới 1</strong> là nhanh hơn thời gian thực. Độ trễ càng thấp càng tốt; VRAM là bộ nhớ GPU đang dùng.</p>
          </div>
        </article>
      </div>

      <div className="engine-recommendation">
        <strong>Gợi ý nhanh</strong>
        <span>Máy phổ thông: <b>tiny/base · CPU · int8</b></span>
        <span>GPU NVIDIA: <b>turbo · CUDA · float16</b></span>
      </div>

      <p className="permission-note">Model được tải về ở lần sử dụng đầu tiên; model lớn sẽ cần thêm thời gian và dung lượng.</p>
    </section>
  );
}
